import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { listAchievements, listTemplateChoices } from "@/lib/issuance/achievements";
import { authenticateAdmin } from "@/lib/security/access";
import { AchievementForm } from "./achievement-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Formaciones · Admin · PopiCert", robots: { index: false, follow: false } };

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

export default async function AchievementsPage({ searchParams }: { searchParams: Promise<{ archivadas?: string }> }) {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const includeArchived = (await searchParams).archivadas === "1";
  const prisma = getPrisma();
  const [achievements, templates] = await Promise.all([listAchievements(prisma, { includeArchived }), listTemplateChoices(prisma)]);

  return (
    <>
      <h1>Formaciones</h1>
      <p className="muted">
        Cada formación es un logro de Open Badges: su nombre, descripción y criterios van firmados en cada certificado que se emita.
      </p>

      <div className="card">
        {achievements.length === 0 ? (
          <p className="muted">{includeArchived ? "No hay ninguna formación." : "No hay formaciones activas."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Formación</th>
                  <th>Horas</th>
                  <th>Certificados</th>
                  <th>Creada</th>
                </tr>
              </thead>
              <tbody>
                {achievements.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/formaciones/${a.id}`}>{a.name}</Link> {a.archivedAt && <span className="badge">archivada</span>}
                    </td>
                    <td>{a.hours ?? "—"}</td>
                    <td>{a.issuedCount}</td>
                    <td className="muted">{dateFormat.format(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          {includeArchived ? <Link href="/admin/formaciones">Ocultar las archivadas</Link> : <Link href="/admin/formaciones?archivadas=1">Ver también las archivadas</Link>}
        </p>
      </div>

      <h2>Nueva formación</h2>
      <div className="card">
        <AchievementForm templates={templates} />
      </div>
    </>
  );
}
