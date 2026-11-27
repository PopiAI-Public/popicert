import type { CertificateSummary } from "@/lib/issuance/certificates";
import { CopyButton } from "../client";

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

export function CertificateState({ certificate }: { certificate: Pick<CertificateSummary, "revokedAt" | "hiddenAt"> }) {
  return (
    <>
      {certificate.revokedAt ? <span className="badge status-error">Revocado</span> : <span className="badge status-issued">Válido</span>}{" "}
      {certificate.hiddenAt && <span className="badge">Oculto</span>}
    </>
  );
}

/** Lista de certificados con su enlace listo para copiar. */
export function CertificateTable({
  certificates,
  showAchievement = false,
  empty,
}: {
  certificates: readonly CertificateSummary[];
  showAchievement?: boolean;
  empty: string;
}) {
  if (certificates.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            {showAchievement && <th>Formación</th>}
            <th>Código</th>
            <th>Estado</th>
            <th>Emitido</th>
            <th>Enlace</th>
          </tr>
        </thead>
        <tbody>
          {certificates.map((c) => (
            <tr key={c.id}>
              <td>
                <a href={`/admin/certificados/${c.id}`}>{c.recipientName}</a>
              </td>
              {showAchievement && (
                <td>
                  <a href={`/admin/formaciones/${c.achievementId}`}>{c.achievementName}</a>
                </td>
              )}
              <td>
                <code>{c.code}</code>
              </td>
              <td>
                <CertificateState certificate={c} />
              </td>
              <td className="muted">{dateFormat.format(c.issuedAt)}</td>
              <td>
                <CopyButton text={c.url} label="Copiar enlace" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
