/**
 * Lo que se enseña de un certificado en la parte pública (KAN-12).
 *
 * Todo sale de la credencial firmada, no de las tablas: la página, el JSON y lo
 * que vea un verificador externo dicen siempre lo mismo. Los campos privados de
 * la plantilla (DNI…) no están en la credencial, así que no pueden aparecer.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { getCertificate, type CertificateDetail } from "@/lib/issuance/certificates";
import { normalizeCertificateCode } from "@/lib/ob/code";
import type { IssuerContext } from "@/lib/ob/issuer";
import { verifyCredential, type VerificationReport } from "@/lib/ob/verify";
import { createStatusAwareDocumentLoader } from "@/lib/status/repository";
import { createStatusChecker } from "@/lib/status/status-list";
import { renderPdf } from "@/lib/templates/render";
import { getTemplateVersion } from "@/lib/templates/repository";
import { createLru, createSemaphore } from "./limits";

export interface PublicField {
  label: string;
  value: string;
}

export interface VisibleCertificate {
  state: "valid" | "revoked";
  id: string;
  code: string;
  url: string;
  recipientName: string;
  achievement: { name: string; description: string; criteria: string; image: string | null };
  issuer: { id: string; name: string; url: string | null };
  issuedAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
  fields: PublicField[];
  credential: Record<string, unknown>;
}

export type PublicCertificate = VisibleCertificate | { state: "hidden"; code: string };

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** Campos públicos de la credencial: `result` con el nombre de su `resultDescription`. */
export function credentialFields(credential: Record<string, unknown>): PublicField[] {
  const subject = obj(credential.credentialSubject);
  const descriptions = new Map(
    list(obj(subject.achievement).resultDescription).map((d) => [str(obj(d).id), str(obj(d).name)] as const),
  );
  return list(subject.result).flatMap((r) => {
    const label = descriptions.get(str(obj(r).resultDescription));
    const value = str(obj(r).value);
    return label && value ? [{ label, value }] : [];
  });
}

function toVisible(certificate: CertificateDetail): VisibleCertificate {
  const credential = certificate.credential as Record<string, unknown>;
  const subject = obj(credential.credentialSubject);
  const achievement = obj(subject.achievement);
  const issuer = obj(credential.issuer);
  return {
    state: certificate.revokedAt ? "revoked" : "valid",
    id: certificate.id,
    code: certificate.code,
    url: certificate.url,
    recipientName: str(subject.name) || certificate.recipientName,
    achievement: {
      name: str(achievement.name),
      description: str(achievement.description),
      criteria: str(obj(achievement.criteria).narrative),
      image: str(obj(achievement.image).id) || null,
    },
    issuer: { id: str(issuer.id), name: str(issuer.name), url: str(issuer.url) || null },
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revokedAt,
    revocationReason: certificate.revocationReason,
    fields: credentialFields(credential),
    credential,
  };
}

async function findByCode(prisma: PrismaClient, input: string): Promise<CertificateDetail | null> {
  const code = normalizeCertificateCode(input);
  if (!code) return null;
  const row = await prisma.credential.findUnique({ where: { code }, select: { id: true } });
  return row ? getCertificate(prisma, row.id) : null;
}

/**
 * El certificado de un código, o `null` si no existe. Un certificado oculto a
 * petición del asistente solo dice que lo está: ni nombre ni formación.
 */
export async function getPublicCertificate(prisma: PrismaClient, code: string): Promise<PublicCertificate | null> {
  const certificate = await findByCode(prisma, code);
  if (!certificate) return null;
  if (certificate.hiddenAt) return { state: "hidden", code: certificate.code };
  return toVisible(certificate);
}

const verifySlots = createSemaphore(4);

/**
 * Verifica una credencial como lo haría un verificador externo, con la lista de
 * estado de la base de datos. Como mucho cuatro a la vez (canonicalización RDF y firma).
 */
export function verifyWithStatus(prisma: PrismaClient, issuer: IssuerContext, credential: unknown, now?: Date): Promise<VerificationReport> {
  const loader = createStatusAwareDocumentLoader(prisma, issuer);
  return verifySlots(() =>
    verifyCredential({ credential, documentLoader: loader, expectedIssuer: issuer.did, checkStatus: createStatusChecker(loader), now }),
  );
}

/**
 * PDF para descargar desde la página pública. Es el mismo diploma, pero con
 * los campos privados de la plantilla (DNI…) en blanco: el enlace del
 * certificado se comparte, y el DNI no debe ir con él. El PDF completo solo se
 * descarga desde el admin.
 */
export async function renderPublicPdf(prisma: PrismaClient, id: string, issuerName: string): Promise<{ pdf: Buffer; code: string } | null> {
  const certificate = await getCertificate(prisma, id);
  if (certificate.hiddenAt) return null;
  // El PDF de un certificado sale siempre igual (misma versión de plantilla,
  // mismos datos, misma fecha): se guarda el último centenar ya generado.
  const cached = pdfCache.get(certificate.id);
  if (cached) return { pdf: cached, code: certificate.code };
  const pdf = await pdfSlots(() => buildPublicPdf(prisma, certificate, issuerName));
  pdfCache.set(certificate.id, pdf);
  return { pdf, code: certificate.code };
}

const pdfCache = createLru<Buffer>(100);
/** Como mucho dos PDF generándose a la vez: es lo que más CPU gasta de la parte pública. */
const pdfSlots = createSemaphore(2);

async function buildPublicPdf(prisma: PrismaClient, certificate: CertificateDetail, issuerName: string): Promise<Buffer> {
  const version = await getTemplateVersion(prisma, certificate.templateVersionId);
  const values = { ...certificate.trainingValues, ...certificate.attendeeValues };
  for (const field of version.fields) if (!field.public) values[field.key] = "";
  const { pdf } = await renderPdf({
    svg: version.svg,
    fields: version.fields.map((f) => (f.public ? f : { ...f, required: false })),
    values,
    code: certificate.code,
    url: certificate.url,
    fonts: version.fonts,
    title: `${certificate.achievementName} — ${certificate.recipientName}`,
    author: issuerName,
    date: certificate.issuedAt,
    attachments: [
      {
        name: `certificado-${certificate.code}.json`,
        content: Buffer.from(JSON.stringify(certificate.credential, null, 2)),
        type: "application/ld+json",
        description: "Credencial verificable Open Badges 3.0 firmada",
      },
    ],
  });
  return pdf;
}

/**
 * «Añadir a LinkedIn» (Add to Profile): abre el formulario de licencias y
 * certificaciones con la organización de PopiAI ya elegida.
 */
export function linkedInUrl(certificate: Pick<VisibleCertificate, "achievement" | "issuedAt" | "url" | "code">, organizationId: string): string {
  const madrid = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", year: "numeric", month: "numeric" }).formatToParts(certificate.issuedAt);
  const part = (type: string) => madrid.find((p) => p.type === type)!.value;
  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: certificate.achievement.name,
    organizationId,
    issueYear: part("year"),
    issueMonth: part("month"),
    certUrl: certificate.url,
    certId: certificate.code,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}
