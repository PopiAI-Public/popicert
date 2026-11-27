import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { authenticateAdmin } from "@/lib/security/access";
import { listTemplates } from "@/lib/templates/repository";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Plantillas · Admin · PopiCert", robots: { index: false, follow: false } };

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function TemplatesPage() {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const templates = await listTemplates(getPrisma());

  return (
    <>
      <h1>Plantillas de diploma</h1>
      <p className="muted">
        Diseña el diploma en SVG siguiendo la guía (<code>docs/plantillas.md</code> en el repositorio), súbelo con sus fuentes y
        PopiCert detectará los campos <code>{"{{campo}}"}</code>.
      </p>

      <h2>Plantillas</h2>
      {templates.length === 0 ? (
        <p className="muted">Todavía no hay ninguna.</p>
      ) : (
        templates.map((template) => (
          <div className="card" key={template.id}>
            <strong>{template.name}</strong>
            <div className="table-wrap">
              <table>
                <tbody>
                  {template.versions.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <a href={`/admin/plantillas/${v.id}`}>Versión {v.version}</a>
                      </td>
                      <td className="muted">{dateFormat.format(v.createdAt)}</td>
                      <td className="muted">{v.createdBy}</td>
                      <td className="muted">{v.fieldCount} campos</td>
                      <td>{v.lockedAt ? <span className="badge locked">Usada en certificados</span> : <span className="badge">Sin usar</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      <h2>Subir una plantilla nueva</h2>
      <div className="card">
        <UploadForm />
      </div>
    </>
  );
}
