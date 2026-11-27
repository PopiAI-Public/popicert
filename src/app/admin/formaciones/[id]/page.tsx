import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { attendeeFields, badgeUrl, getAchievement, listTemplateChoices } from "@/lib/issuance/achievements";
import { searchCertificates } from "@/lib/issuance/certificates";
import { toTsv } from "@/lib/issuance/csv";
import { NotFoundError } from "@/lib/issuance/errors";
import { authenticateAdmin } from "@/lib/security/access";
import { CopyButton } from "../../client";
import { CertificateTable } from "../../certificados/certificate-table";
import { AchievementForm } from "../achievement-form";
import { ArchiveControls, BadgeForm, IssueForm } from "./actions";
import { CsvIssue } from "./csv-issue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Formación · Admin · PopiCert", robots: { index: false, follow: false } };

export default async function AchievementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const { id } = await params;
  const query = (await searchParams).q ?? "";

  const prisma = getPrisma();
  const achievement = await getAchievement(prisma, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [templates, certificates] = await Promise.all([
    listTemplateChoices(prisma),
    searchCertificates(prisma, { achievementId: id, query, take: 2000 }),
  ]);
  const archived = Boolean(achievement.archivedAt);
  const version = achievement.templateVersion;
  const fields = attendeeFields(version.fields);
  const linkList = toTsv([["Nombre", "Enlace", "Código"], ...certificates.filter((c) => !c.revokedAt).map((c) => [c.recipientName, c.url, c.code])]);

  return (
    <>
      <p>
        <Link href="/admin/formaciones">← Formaciones</Link>
      </p>
      <h1>
        {achievement.name} {archived && <span className="badge">archivada</span>}
      </h1>
      <p className="muted">
        {achievement.hours ? `${achievement.hours} horas · ` : ""}
        Plantilla <a href={`/admin/plantillas/${version.id}`}>{version.templateName} (versión {version.version})</a> · {achievement.issuedCount} certificado
        {achievement.issuedCount === 1 ? "" : "s"}
      </p>

      {archived ? (
        <p className="notice warn">Archivada: no admite emisiones. Los certificados emitidos siguen siendo válidos.</p>
      ) : (
        <>
          <h2>Emitir desde un CSV</h2>
          <div className="card">
            <CsvIssue achievementId={achievement.id} />
          </div>

          <h2>Emitir un certificado</h2>
          <div className="card">
            <IssueForm achievementId={achievement.id} fields={fields} />
          </div>
        </>
      )}

      <h2 id="certificados">Certificados</h2>
      <div className="card">
        <form className="search" action={`/admin/formaciones/${achievement.id}#certificados`}>
          <input type="search" name="q" defaultValue={query} placeholder="Buscar por nombre o código" aria-label="Buscar por nombre o código" />
          <button type="submit" className="secondary">
            Buscar
          </button>
        </form>
        {certificates.length > 0 && (
          <div className="actions">
            <CopyButton text={linkList} label="Copiar nombres y enlaces" className="small" />
            <a className="button secondary small" href={`/api/admin/formaciones/${achievement.id}/certificados.csv`}>
              Exportar a CSV
            </a>
          </div>
        )}
        <CertificateTable certificates={certificates} empty={query ? "Ningún certificado coincide con la búsqueda." : "Todavía no hay certificados."} />
      </div>

      <h2>Datos de la formación</h2>
      <div className="card">
        {archived ? (
          <dl className="facts">
            <dt>Descripción</dt>
            <dd>{achievement.description}</dd>
            <dt>Criterios</dt>
            <dd>{achievement.criteria}</dd>
          </dl>
        ) : (
          <AchievementForm
            achievementId={achievement.id}
            templates={templates}
            issuedCount={achievement.issuedCount}
            initial={{
              name: achievement.name,
              description: achievement.description,
              criteria: achievement.criteria,
              hours: achievement.hours,
              templateVersionId: achievement.templateVersionId,
              trainingValues: achievement.trainingValues,
            }}
          />
        )}
      </div>

      <h2>Insignia</h2>
      <div className="card">
        {achievement.badgeSha256 && achievement.badgeMimeType ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen servida por la propia app, sin optimizar
          <img className="badge-image" src={`/api/admin/formaciones/${achievement.id}/insignia?v=${achievement.badgeSha256.slice(0, 12)}`} alt={`Insignia de ${achievement.name}`} />
        ) : (
          <p className="muted">Sin insignia. Es opcional: la credencial es válida igual, pero se ve mejor en las carteras de credenciales y en LinkedIn.</p>
        )}
        <BadgeForm achievementId={achievement.id} disabled={archived} />
        {achievement.badgeSha256 && achievement.badgeMimeType && (
          <p className="muted">
            URL pública: <code>{badgeUrl(getConfig().PUBLIC_URL, achievement.badgeSha256, achievement.badgeMimeType)}</code>
          </p>
        )}
      </div>

      <h2>Archivar o borrar</h2>
      <div className="card">
        <ArchiveControls achievementId={achievement.id} archived={archived} issuedCount={achievement.issuedCount} />
        <p className="muted" style={{ marginBottom: 0 }}>
          <Link href={`/admin/auditoria?objeto=${achievement.id}`}>Ver el registro de auditoría de la formación</Link>
        </p>
      </div>
    </>
  );
}
