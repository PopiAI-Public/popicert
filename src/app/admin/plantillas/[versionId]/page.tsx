import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { authenticateAdmin } from "@/lib/security/access";
import { getTemplateVersion, isUuid, listTemplates, TemplateNotFoundError } from "@/lib/templates/repository";
import { FieldsForm } from "../fields-form";
import { UploadForm } from "../upload-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Plantilla · Admin · PopiCert", robots: { index: false, follow: false } };

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function TemplateVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const { versionId } = await params;
  if (!isUuid(versionId)) notFound();

  const prisma = getPrisma();
  const version = await getTemplateVersion(prisma, versionId).catch((error: unknown) => {
    if (error instanceof TemplateNotFoundError) notFound();
    throw error;
  });
  const siblings = (await listTemplates(prisma)).find((t) => t.id === version.templateId)?.versions ?? [];
  const base = `/api/admin/plantillas/versiones/${version.id}`;
  // El sha256 en la URL de la vista previa evita que el navegador enseñe una versión vieja de la imagen.
  const previewKey = `${version.svgSha256.slice(0, 12)}-${version.fields.map((f) => f.key + f.label).join("").length}`;

  return (
    <>
      <p>
        <Link href="/admin/plantillas">← Plantillas</Link>
      </p>
      <h1>
        {version.templateName} · versión {version.version}{" "}
        {version.lockedAt ? <span className="badge locked">Usada en certificados</span> : <span className="badge">Sin usar</span>}
      </h1>
      <p className="muted">
        Subida el {dateFormat.format(version.createdAt)} por {version.createdBy}. A4 {version.orientation === "landscape" ? "horizontal" : "vertical"}.
        {version.lockedAt && ` Se usó por primera vez el ${dateFormat.format(version.lockedAt)}: ya no cambia; para modificarla, sube una versión nueva.`}
      </p>

      {version.report.removed.length > 0 && (
        <div className="notice warn">
          <strong>Se quitó del SVG por seguridad:</strong>
          <ul className="plain">
            {version.report.removed.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {version.report.warnings.length > 0 && (
        <div className="notice warn">
          <strong>Avisos:</strong>
          <ul className="plain">
            {version.report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <h2>Vista previa con datos de ejemplo</h2>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG generado al vuelo; next/image no aporta nada aquí */}
        <img className="preview" src={`${base}/vista-previa.svg?k=${previewKey}`} alt="Vista previa del diploma con datos de ejemplo" />
        <div className="actions">
          <a className="button" href={`${base}/vista-previa.pdf?k=${previewKey}`} target="_blank" rel="noopener">
            Abrir el PDF de prueba
          </a>
        </div>
      </div>

      <h2>Campos</h2>
      <div className="card">
        <FieldsForm versionId={version.id} initial={version.fields} locked={Boolean(version.lockedAt)} />
      </div>

      <h2>Fuentes</h2>
      <div className="card">
        {version.fonts.length === 0 ? (
          <p className="muted">Sin fuentes subidas: se usan las estándar del PDF.</p>
        ) : (
          <ul className="plain">
            {version.fonts.map((f) => (
              <li key={f.id}>
                {f.family} {f.bold ? "negrita" : ""} {f.italic ? "cursiva" : ""} <span className="muted">({f.fileName})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2>Versiones</h2>
      <div className="card">
        <ul className="plain">
          {siblings.map((v) => (
            <li key={v.id}>
              {v.id === version.id ? <strong>Versión {v.version} (esta)</strong> : <a href={`/admin/plantillas/${v.id}`}>Versión {v.version}</a>}{" "}
              {v.lockedAt && <span className="badge locked">usada</span>}
            </li>
          ))}
        </ul>
        <h3>Subir una versión nueva</h3>
        <p className="muted">La configuración de los campos que sigan existiendo se copia de la última versión.</p>
        <UploadForm templateId={version.templateId} />
      </div>
    </>
  );
}
