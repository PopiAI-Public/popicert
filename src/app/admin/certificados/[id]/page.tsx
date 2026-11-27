import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listAuditLog } from "@/lib/audit";
import { getPrisma } from "@/lib/db";
import { getCertificate } from "@/lib/issuance/certificates";
import { NotFoundError } from "@/lib/issuance/errors";
import { authenticateAdmin } from "@/lib/security/access";
import { getTemplateVersion } from "@/lib/templates/repository";
import { CopyButton } from "../../client";
import { CertificateState } from "../certificate-table";
import { HideForm, RevokeForm } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Certificado · Admin · PopiCert", robots: { index: false, follow: false } };

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const { id } = await params;
  const prisma = getPrisma();
  const certificate = await getCertificate(prisma, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [version, log] = await Promise.all([getTemplateVersion(prisma, certificate.templateVersionId), listAuditLog(prisma, { targetId: id })]);
  const values = { ...certificate.trainingValues, ...certificate.attendeeValues };
  const base = `/api/admin/certificados/${certificate.id}`;

  return (
    <>
      <p>
        <Link href={`/admin/formaciones/${certificate.achievementId}`}>← {certificate.achievementName}</Link>
      </p>
      <h1>
        {certificate.recipientName} <CertificateState certificate={certificate} />
      </h1>

      <div className="card">
        <p className="actions" style={{ marginTop: 0 }}>
          <code>{certificate.url}</code>
          <CopyButton text={certificate.url} label="Copiar enlace" />
          <CopyButton text={certificate.code} label="Copiar código" />
        </p>
        <div className="actions">
          <a className="button" href={`${base}/certificado.pdf`} target="_blank" rel="noopener">
            Ver el PDF
          </a>
          <a className="button secondary" href={`${base}/credencial.json`}>
            Descargar la credencial (JSON)
          </a>
        </div>
        <dl className="facts">
          <dt>Código</dt>
          <dd>
            <code>{certificate.code}</code>
          </dd>
          <dt>Emitido</dt>
          <dd>
            {dateFormat.format(certificate.issuedAt)} por {certificate.issuedBy}
          </dd>
          {certificate.recipientEmail && (
            <>
              <dt>Email</dt>
              <dd>{certificate.recipientEmail} (en la credencial solo va con hash)</dd>
            </>
          )}
          <dt>Plantilla</dt>
          <dd>
            <a href={`/admin/plantillas/${version.id}`}>
              {version.templateName} (versión {version.version})
            </a>
          </dd>
          <dt>Revocación</dt>
          <dd>
            Lista {certificate.statusListId}, posición {certificate.statusListIndex}
          </dd>
        </dl>
      </div>

      <h2>Datos del diploma</h2>
      <div className="card">
        <div className="table-wrap">
          <table>
            <tbody>
              {version.fields.map((field) => (
                <tr key={field.key}>
                  <th>{field.label}</th>
                  <td>{values[field.key] || <span className="muted">—</span>}</td>
                  <td>{field.public ? <span className="badge">público</span> : <span className="badge locked">solo en el PDF</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Revocar</h2>
      <div className="card">
        {certificate.revokedAt ? (
          <p className="notice error" style={{ margin: 0 }}>
            Revocado el {dateFormat.format(certificate.revokedAt)}. Motivo: {certificate.revocationReason}
          </p>
        ) : (
          <RevokeForm certificateId={certificate.id} recipientName={certificate.recipientName} />
        )}
      </div>

      <h2>Ocultar (RGPD)</h2>
      <div className="card">
        {certificate.hiddenAt && (
          <p className="notice warn">
            Oculto desde el {dateFormat.format(certificate.hiddenAt)}. Motivo: {certificate.hiddenReason}
          </p>
        )}
        <HideForm certificateId={certificate.id} hidden={Boolean(certificate.hiddenAt)} />
      </div>

      <h2>Registro</h2>
      <div className="card">
        <ul className="plain">
          {log.map((entry) => (
            <li key={entry.id}>
              {dateFormat.format(entry.createdAt)} · <code>{entry.action}</code> · {entry.actorEmail}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
