/**
 * Emisión, revocación y ocultación de certificados (KAN-11).
 *
 * Emitir un certificado:
 *
 * 1. Se validan los datos del asistente rellenando la plantilla (sin generar el
 *    PDF): obligatorios, longitud y caracteres que falten en las fuentes. Si
 *    algo falla, falla aquí y no se emite nada.
 * 2. Si el asistente ya tiene un certificado vigente en la formación, se
 *    devuelve ese. Es lo que hace idempotente repetir un CSV.
 * 3. Se reserva una posición en la lista de revocación, se construye la
 *    `OpenBadgeCredential` y se firma.
 * 4. En una transacción: se bloquea la versión de la plantilla (ya no cambia),
 *    se guarda el certificado y se apunta en la auditoría. El índice único
 *    parcial de la base de datos impide dos certificados vigentes del mismo
 *    asistente aunque dos emisiones lleguen a la vez.
 */
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { generateCertificateCode, normalizeCertificateCode } from "@/lib/ob/code";
import { buildOpenBadgeCredential, type OpenBadgeCredential, type PublicField } from "@/lib/ob/credential";
import { normalizeEmail } from "@/lib/ob/identity";
import type { IssuerContext } from "@/lib/ob/issuer";
import { signCredential } from "@/lib/ob/sign";
import { allocateStatusEntry, revokeStatusEntryInTransaction } from "@/lib/status/repository";
import { TemplateError } from "@/lib/templates/errors";
import { normalizeFieldValue, type FieldConfig } from "@/lib/templates/fields";
import { createTemplateFiller, renderPdf, type FilledTemplate, type FillInput } from "@/lib/templates/render";
import { getTemplateVersion, isUuid, lockTemplateVersion } from "@/lib/templates/repository";
import { SAMPLE_CODE } from "@/lib/templates/samples";
import {
  attendeeFields,
  badgeUrl,
  checkTemplateUsable,
  effectiveTrainingValues,
  getAchievement,
  NAME_FIELD,
  type AchievementWithTemplate,
} from "./achievements";
import { csvAttendees, mapColumns, MAX_CSV_BYTES, parseCsv } from "./csv";
import { dedupeKey, IDENTIFIER_FIELD } from "./dedupe";
import { IssuanceError, NotFoundError } from "./errors";

type Db = PrismaClient | Prisma.TransactionClient;

export const MAX_REASON_LENGTH = 500;

export interface IssueContext {
  prisma: PrismaClient;
  issuer: IssuerContext;
  actorEmail: string;
  /** Fecha de emisión. Por defecto, ahora. */
  now?: Date;
}

export interface CertificateSummary {
  id: string;
  code: string;
  url: string;
  achievementId: string;
  /** El nombre de la formación tal como va firmado en el certificado. */
  achievementName: string;
  recipientName: string;
  recipientEmail: string | null;
  issuedAt: Date;
  issuedBy: string;
  revokedAt: Date | null;
  revocationReason: string | null;
  hiddenAt: Date | null;
  hiddenReason: string | null;
}

export interface CertificateDetail extends CertificateSummary {
  templateVersionId: string;
  attendeeValues: Record<string, string>;
  trainingValues: Record<string, string>;
  credential: OpenBadgeCredential;
  statusListId: number;
  statusListIndex: number;
}

const summarySelect = {
  id: true,
  code: true,
  achievementId: true,
  recipientName: true,
  recipientEmail: true,
  issuedAt: true,
  issuedBy: true,
  revokedAt: true,
  revocationReason: true,
  hiddenAt: true,
  hiddenReason: true,
  credential: true,
} satisfies Prisma.CredentialSelect;

type SummaryRow = Prisma.CredentialGetPayload<{ select: typeof summarySelect }>;

function toSummary(row: SummaryRow): CertificateSummary {
  const signed = row.credential as OpenBadgeCredential;
  return {
    id: row.id,
    code: row.code,
    url: signed.id,
    achievementId: row.achievementId,
    achievementName: typeof signed.name === "string" ? signed.name : "",
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    issuedAt: row.issuedAt,
    issuedBy: row.issuedBy,
    revokedAt: row.revokedAt,
    revocationReason: row.revocationReason,
    hiddenAt: row.hiddenAt,
    hiddenReason: row.hiddenReason,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Los triggers de la base de datos hablan con mensajes que empiezan por «popicert:». */
function asIssuanceError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const match = /popicert: ([^\n"]+)/.exec(message);
  if (match) throw new IssuanceError(match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1) + ".");
  throw error;
}

/** Una formación lista para emitir: su plantilla, sus valores y el validador de filas. */
export interface Issuable {
  achievement: AchievementWithTemplate;
  trainingValues: Record<string, string>;
  fill: (input: Omit<FillInput, "fonts">) => FilledTemplate;
}

export async function loadIssuable(db: Db, achievementId: string): Promise<Issuable> {
  const achievement = await getAchievement(db, achievementId);
  if (achievement.archivedAt) throw new IssuanceError("La formación está archivada: no admite emisiones.");
  checkTemplateUsable(achievement.templateVersion);
  return {
    achievement,
    trainingValues: effectiveTrainingValues(achievement),
    fill: createTemplateFiller(achievement.templateVersion.fonts),
  };
}

export interface AttendeeInput {
  values: Readonly<Record<string, unknown>>;
  email?: string | null;
}

export interface PreparedAttendee {
  name: string;
  email: string | null;
  attendeeValues: Record<string, string>;
  dedupeKey: string;
}

const emailSchema = z.email();

/** Valida los datos de un asistente contra la plantilla de la formación. Lanza `IssuanceError` con todos los problemas. */
export function prepareAttendee(issuable: Issuable, input: AttendeeInput): PreparedAttendee {
  const version = issuable.achievement.templateVersion;
  const attendeeValues: Record<string, string> = {};
  for (const field of attendeeFields(version.fields)) {
    const value = normalizeFieldValue(input.values[field.key]);
    if (value) attendeeValues[field.key] = value;
  }

  let email: string | null = null;
  const rawEmail = normalizeFieldValue(input.email);
  if (rawEmail) {
    email = normalizeEmail(rawEmail);
    if (!emailSchema.safeParse(email).success) throw new IssuanceError(`El email «${rawEmail}» no es válido.`);
  }

  try {
    issuable.fill({
      svg: version.svg,
      fields: version.fields,
      values: { ...issuable.trainingValues, ...attendeeValues },
      code: SAMPLE_CODE,
      url: `https://example.invalid/c/${SAMPLE_CODE}`,
    });
  } catch (error) {
    if (error instanceof TemplateError) throw new IssuanceError(error.message);
    throw error;
  }

  const name = attendeeValues[NAME_FIELD]!;
  return { name, email, attendeeValues, dedupeKey: dedupeKey({ nombre: name, dni: attendeeValues[IDENTIFIER_FIELD] }) };
}

async function findActive(db: Db, achievementId: string, key: string): Promise<CertificateSummary | null> {
  const row = await db.credential.findFirst({ where: { achievementId, dedupeKey: key, revokedAt: null }, select: summarySelect });
  return row ? toSummary(row) : null;
}

export type IssueOutcome = { status: "issued" | "existing"; certificate: CertificateSummary };

/**
 * Los campos públicos de la plantilla, con su valor, para la credencial y la
 * página pública. El nombre y la formación no se repiten: ya van como nombre del
 * titular y del logro. Los privados (DNI…) no salen nunca de aquí.
 */
export function publicFields(fields: readonly FieldConfig[], values: Readonly<Record<string, string>>): PublicField[] {
  return fields
    .filter((f) => f.public && f.key !== NAME_FIELD && f.key !== "formacion" && values[f.key])
    .map((f) => ({ key: f.key, label: f.label, value: values[f.key]! }));
}

/** Segundos enteros: es la precisión de `validFrom`, y así la fecha del PDF y la de la credencial coinciden. */
const wholeSeconds = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);

/** Emite el certificado de un asistente ya validado, o devuelve el que ya tenía. */
export async function issuePrepared(ctx: IssueContext, issuable: Issuable, attendee: PreparedAttendee): Promise<IssueOutcome> {
  const { prisma, issuer } = ctx;
  const { achievement } = issuable;
  const version = achievement.templateVersion;

  const existing = await findActive(prisma, achievement.id, attendee.dedupeKey);
  if (existing) return { status: "existing", certificate: existing };

  const status = await allocateStatusEntry(prisma, issuer);
  const releaseStatus = () => prisma.statusEntry.delete({ where: { id: status.entryId } }).catch(() => undefined);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCertificateCode();
      const issuedAt = wholeSeconds(ctx.now ?? new Date());
      const unsigned = buildOpenBadgeCredential({
        id: `${issuer.publicUrl}/c/${code}`,
        issuer: issuer.profile,
        achievement: {
          id: `urn:uuid:${achievement.id}`,
          name: achievement.name,
          description: achievement.description,
          criteria: achievement.criteria,
          ...(achievement.badgeSha256 && achievement.badgeMimeType
            ? { image: { id: badgeUrl(issuer.publicUrl, achievement.badgeSha256, achievement.badgeMimeType), caption: `Insignia de ${achievement.name}` } }
            : {}),
        },
        recipient: { name: attendee.name, ...(attendee.email ? { email: attendee.email } : {}) },
        validFrom: issuedAt,
        credentialStatus: status.credentialStatus,
        fields: publicFields(version.fields, { ...issuable.trainingValues, ...attendee.attendeeValues }),
      });
      const signed = await signCredential({ credential: unsigned, keyRing: issuer.keyRing, documentLoader: issuer.documentLoader, date: issuedAt });

      try {
        const row = await prisma.$transaction(async (tx) => {
          const current = await tx.$queryRaw<{ archived_at: Date | null; template_version_id: string }[]>`
            SELECT archived_at, template_version_id FROM "achievement" WHERE id = ${achievement.id}::uuid FOR SHARE`;
          if (!current[0]) throw new NotFoundError("formación");
          if (current[0].archived_at) throw new IssuanceError("La formación está archivada: no admite emisiones.");
          if (current[0].template_version_id !== version.id) {
            throw new IssuanceError("La formación ha cambiado de plantilla mientras se emitía: vuelve a intentarlo.");
          }
          // Desde aquí la versión de la plantilla ya no cambia. Si alguien tocó sus
          // campos justo antes, los datos se validaron con otros: mejor no emitir.
          await lockTemplateVersion(tx, version.id, issuedAt);
          const fields = await tx.templateVersion.findUniqueOrThrow({ where: { id: version.id }, select: { fields: true } });
          if (JSON.stringify(fields.fields) !== JSON.stringify(version.fields)) {
            throw new IssuanceError("Los campos de la plantilla han cambiado mientras se emitía: vuelve a intentarlo.");
          }

          const created = await tx.credential.create({
            data: {
              code,
              achievementId: achievement.id,
              templateVersionId: version.id,
              statusEntryId: status.entryId,
              recipientName: attendee.name,
              recipientEmail: attendee.email,
              dedupeKey: attendee.dedupeKey,
              attendeeValues: attendee.attendeeValues,
              trainingValues: issuable.trainingValues,
              credential: signed as unknown as Prisma.InputJsonValue,
              issuedAt,
              issuedBy: ctx.actorEmail,
            },
            select: summarySelect,
          });
          await audit(tx, {
            actorEmail: ctx.actorEmail,
            action: "certificate.issue",
            targetType: "certificate",
            targetId: created.id,
            details: { code, achievementId: achievement.id, recipientName: attendee.name, templateVersionId: version.id },
          });
          return created;
        });
        return { status: "issued", certificate: toSummary(row) };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // O ya tiene certificado (otra emisión ha llegado antes), o ha salido un código repetido.
        const winner = await findActive(prisma, achievement.id, attendee.dedupeKey);
        if (winner) {
          await releaseStatus();
          return { status: "existing", certificate: winner };
        }
      }
    }
    throw new Error("No se ha podido generar un código de certificado libre.");
  } catch (error) {
    await releaseStatus();
    throw error;
  }
}

/** Emisión individual desde la ficha de la formación. */
export async function issueCertificate(ctx: IssueContext, achievementId: string, input: AttendeeInput): Promise<IssueOutcome> {
  const issuable = await loadIssuable(ctx.prisma, achievementId);
  return issuePrepared(ctx, issuable, prepareAttendee(issuable, input));
}

export type BatchRowStatus = "ok" | "existing" | "error" | "issued";

export interface BatchRow {
  /** Línea del CSV (la cabecera es la 1). */
  line: number;
  name: string;
  status: BatchRowStatus;
  messages: string[];
  certificate?: CertificateSummary;
}

export interface BatchReport {
  rows: BatchRow[];
  /** Columnas del CSV que no son de ningún campo y se han ignorado. */
  ignoredColumns: string[];
  counts: Record<BatchRowStatus, number>;
}

function countRows(rows: readonly BatchRow[]): Record<BatchRowStatus, number> {
  const counts: Record<BatchRowStatus, number> = { ok: 0, existing: 0, error: 0, issued: 0 };
  for (const row of rows) counts[row.status]++;
  return counts;
}

interface AnalyzedRow extends BatchRow {
  prepared?: PreparedAttendee;
}

async function analyzeCsv(db: Db, issuable: Issuable, csv: string): Promise<{ rows: AnalyzedRow[]; ignoredColumns: string[] }> {
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) throw new IssuanceError(`El CSV ocupa más de ${MAX_CSV_BYTES / 1024 / 1024} MB.`);
  const parsed = parseCsv(csv);
  const mapping = mapColumns(parsed.header, attendeeFields(issuable.achievement.templateVersion.fields));
  const attendees = csvAttendees(parsed, mapping);
  if (attendees.length === 0) throw new IssuanceError("El CSV no tiene ninguna fila de asistentes.");

  const firstLine = new Map<string, number>();
  const rows: AnalyzedRow[] = attendees.map((attendee) => {
    const name = normalizeFieldValue(attendee.values[NAME_FIELD]);
    try {
      const prepared = prepareAttendee(issuable, attendee);
      const previous = firstLine.get(prepared.dedupeKey);
      if (previous !== undefined) {
        return { line: attendee.line, name, status: "error", messages: [`Repetido: es el mismo asistente que la línea ${previous}.`] };
      }
      firstLine.set(prepared.dedupeKey, attendee.line);
      return { line: attendee.line, name, status: "ok", messages: [], prepared };
    } catch (error) {
      if (error instanceof IssuanceError) return { line: attendee.line, name, status: "error", messages: [error.message] };
      throw error;
    }
  });

  const keys = rows.flatMap((r) => (r.prepared ? [r.prepared.dedupeKey] : []));
  const existing = await db.credential.findMany({
    where: { achievementId: issuable.achievement.id, dedupeKey: { in: keys }, revokedAt: null },
    select: { ...summarySelect, dedupeKey: true },
  });
  const byKey = new Map(existing.map((row) => [row.dedupeKey, toSummary(row)]));
  for (const row of rows) {
    const found = row.prepared && byKey.get(row.prepared.dedupeKey);
    if (found) Object.assign(row, { status: "existing", messages: ["Ya tiene certificado: no se emite otro."], certificate: found });
  }
  return { rows, ignoredColumns: mapping.ignored };
}

function publicRow(row: AnalyzedRow): BatchRow {
  const copy = { ...row };
  delete copy.prepared;
  return copy;
}

/** Validación fila a fila de un CSV, sin emitir nada. */
export async function previewCsv(db: Db, achievementId: string, csv: string): Promise<BatchReport> {
  const issuable = await loadIssuable(db, achievementId);
  const { rows, ignoredColumns } = await analyzeCsv(db, issuable, csv);
  return { rows: rows.map(publicRow), ignoredColumns, counts: countRows(rows) };
}

/**
 * Emite la tanda de un CSV: las filas válidas se emiten, las que ya tenían
 * certificado lo conservan y las que tienen errores se quedan sin emitir.
 * Vuelve a validar todo: no se fía de la vista previa.
 */
export async function issueCsv(ctx: IssueContext, achievementId: string, csv: string): Promise<BatchReport> {
  const issuable = await loadIssuable(ctx.prisma, achievementId);
  const { rows, ignoredColumns } = await analyzeCsv(ctx.prisma, issuable, csv);
  for (const row of rows) {
    if (row.status !== "ok" || !row.prepared) continue;
    try {
      const outcome = await issuePrepared(ctx, issuable, row.prepared);
      row.status = outcome.status;
      row.certificate = outcome.certificate;
      if (outcome.status === "existing") row.messages = ["Ya tiene certificado: no se emite otro."];
    } catch (error) {
      if (!(error instanceof IssuanceError || error instanceof NotFoundError)) throw error;
      row.status = "error";
      row.messages = [error.message];
    }
  }
  const report = { rows: rows.map(publicRow), ignoredColumns, counts: countRows(rows) };
  await audit(ctx.prisma, {
    actorEmail: ctx.actorEmail,
    action: "certificate.batch",
    targetType: "achievement",
    targetId: achievementId,
    details: { rows: rows.length, issued: report.counts.issued, existing: report.counts.existing, errors: report.counts.error },
  });
  return report;
}

function cleanReason(reason: unknown, what: string): string {
  const clean = normalizeFieldValue(reason);
  if (!clean) throw new IssuanceError(`Escribe el motivo ${what}.`);
  if (clean.length > MAX_REASON_LENGTH) throw new IssuanceError(`El motivo tiene más de ${MAX_REASON_LENGTH} caracteres.`);
  return clean;
}

/**
 * Revoca: marca la posición en la lista de estado, vuelve a firmar la lista y
 * apunta la revocación en el certificado, todo en la misma transacción.
 * Revocar dos veces no hace nada y devuelve la revocación original.
 */
export async function revokeCertificate(
  ctx: IssueContext,
  id: string,
  reasonInput: unknown,
): Promise<{ certificate: CertificateSummary; alreadyRevoked: boolean }> {
  if (!isUuid(id)) throw new NotFoundError("certificado");
  const reason = cleanReason(reasonInput, "de la revocación");
  return ctx.prisma
    .$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "credential" WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundError("certificado");
        const current = await tx.credential.findUniqueOrThrow({ where: { id }, select: { ...summarySelect, statusEntryId: true } });
        if (current.revokedAt) return { certificate: toSummary(current), alreadyRevoked: true };

        const result = await revokeStatusEntryInTransaction(tx, ctx.issuer, { entryId: current.statusEntryId, reason, now: ctx.now });
        const row = await tx.credential.update({
          where: { id },
          data: { revokedAt: result.revokedAt, revocationReason: result.reason },
          select: summarySelect,
        });
        await audit(tx, { actorEmail: ctx.actorEmail, action: "certificate.revoke", targetType: "certificate", targetId: id, details: { code: row.code, reason: result.reason } });
        return { certificate: toSummary(row), alreadyRevoked: false };
      },
      { timeout: 15_000 },
    )
    .catch(asIssuanceError);
}

/** Oculta (o vuelve a mostrar) un certificado a petición del asistente (RGPD). */
export async function setCertificateHidden(
  prisma: PrismaClient,
  id: string,
  options: { hidden: boolean; reason?: unknown; actorEmail: string },
): Promise<CertificateSummary> {
  if (!isUuid(id)) throw new NotFoundError("certificado");
  const reason = options.hidden ? cleanReason(options.reason, "por el que se oculta") : null;
  return prisma.$transaction(async (tx) => {
    const current = await tx.credential.findUnique({ where: { id }, select: { hiddenAt: true } });
    if (!current) throw new NotFoundError("certificado");
    const row = await tx.credential.update({
      where: { id },
      data: options.hidden ? { hiddenAt: current.hiddenAt ?? new Date(), hiddenReason: reason } : { hiddenAt: null, hiddenReason: null },
      select: summarySelect,
    });
    await audit(tx, {
      actorEmail: options.actorEmail,
      action: options.hidden ? "certificate.hide" : "certificate.unhide",
      targetType: "certificate",
      targetId: id,
      details: { code: row.code, ...(reason ? { reason } : {}) },
    });
    return toSummary(row);
  });
}

/**
 * Búsqueda del admin por nombre (contiene, sin distinguir mayúsculas) o por
 * código (completo o un trozo, con o sin guiones).
 */
export async function searchCertificates(
  db: Db,
  options: { query?: string; achievementId?: string; take?: number } = {},
): Promise<CertificateSummary[]> {
  const query = normalizeFieldValue(options.query).slice(0, 100);
  const where: Prisma.CredentialWhereInput = {};
  if (options.achievementId) where.achievementId = options.achievementId;
  if (query) {
    const code = normalizeCertificateCode(query);
    const codePart = query.toUpperCase().replace(/[\s-]/g, "");
    where.OR = [
      { recipientName: { contains: query, mode: "insensitive" } },
      ...(code ? [{ code }] : codePart.length >= 3 ? [{ code: { contains: codePart } }] : []),
    ];
  }
  const rows = await db.credential.findMany({
    where,
    orderBy: [{ issuedAt: "desc" }, { recipientName: "asc" }],
    take: Math.min(options.take ?? 200, 2000),
    select: summarySelect,
  });
  // Los de una misma tanda se emiten en el mismo segundo: entre ellos, orden
  // natural por nombre («Número 2» antes que «Número 10»), sin tildes ni mayúsculas.
  return rows
    .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || nameCollator.compare(a.recipientName, b.recipientName))
    .map(toSummary);
}

const nameCollator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export async function getCertificate(db: Db, id: string): Promise<CertificateDetail> {
  if (!isUuid(id)) throw new NotFoundError("certificado");
  const row = await db.credential.findUnique({
    where: { id },
    select: { ...summarySelect, templateVersionId: true, attendeeValues: true, trainingValues: true, statusEntry: { select: { listId: true, index: true } } },
  });
  if (!row) throw new NotFoundError("certificado");
  return {
    ...toSummary(row),
    templateVersionId: row.templateVersionId,
    attendeeValues: row.attendeeValues as Record<string, string>,
    trainingValues: row.trainingValues as Record<string, string>,
    credential: row.credential as OpenBadgeCredential,
    statusListId: row.statusEntry.listId,
    statusListIndex: row.statusEntry.index,
  };
}

/**
 * El PDF del certificado: la versión de la plantilla con la que se emitió, los
 * datos guardados y la fecha de emisión, así que sale igual cada vez. Lleva
 * dentro la credencial firmada como fichero adjunto.
 */
export async function renderCertificatePdf(db: Db, certificate: CertificateDetail, issuerName: string): Promise<Buffer> {
  const version = await getTemplateVersion(db, certificate.templateVersionId);
  const { pdf } = await renderPdf({
    svg: version.svg,
    fields: version.fields,
    values: { ...certificate.trainingValues, ...certificate.attendeeValues },
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

const exportDate = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeZone: "Europe/Madrid" });

/** Filas para exportar una tanda: lo que hace falta para enviar los enlaces por nuestros medios. */
export function exportRows(certificates: readonly CertificateSummary[]): string[][] {
  return [
    ["Nombre", "Email", "Enlace", "Código", "Estado", "Emitido"],
    ...certificates.map((c) => [
      c.recipientName,
      c.recipientEmail ?? "",
      c.url,
      c.code,
      c.revokedAt ? "Revocado" : c.hiddenAt ? "Oculto" : "Válido",
      exportDate.format(c.issuedAt),
    ]),
  ];
}
