import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listAuditLog } from "@/lib/audit";
import { getPrisma } from "@/lib/db";
import { isUuid } from "@/lib/templates/repository";
import { authenticateAdmin } from "@/lib/security/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Auditoría · Admin · PopiCert", robots: { index: false, follow: false } };

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Madrid" });

const TARGET_LINK: Record<string, (id: string) => string> = {
  achievement: (id) => `/admin/formaciones/${id}`,
  certificate: (id) => `/admin/certificados/${id}`,
  template_version: (id) => `/admin/plantillas/${id}`,
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ objeto?: string }> }) {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const target = (await searchParams).objeto;
  const entries = await listAuditLog(getPrisma(), { targetId: target && isUuid(target) ? target : undefined, take: 500 });

  return (
    <>
      <h1>Registro de auditoría</h1>
      <p className="muted">
        Cada acción del admin: quién (el email con el que entró en Cloudflare Access), qué y cuándo. Las últimas 500.
        {target && (
          <>
            {" "}
            <Link href="/admin/auditoria">Ver todo</Link>
          </>
        )}
      </p>
      <div className="card">
        {entries.length === 0 ? (
          <p className="muted">Sin acciones registradas.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Quién</th>
                  <th>Qué</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const link = e.targetType && e.targetId ? TARGET_LINK[e.targetType]?.(e.targetId) : undefined;
                  return (
                    <tr key={e.id}>
                      <td className="muted">{dateFormat.format(e.createdAt)}</td>
                      <td>{e.actorEmail}</td>
                      <td>{link ? <a href={link}><code>{e.action}</code></a> : <code>{e.action}</code>}</td>
                      <td>
                        <code className="details">{JSON.stringify(e.details)}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
