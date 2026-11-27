import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { searchCertificates } from "@/lib/issuance/certificates";
import { authenticateAdmin } from "@/lib/security/access";
import { CertificateTable } from "./certificate-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Certificados · Admin · PopiCert", robots: { index: false, follow: false } };

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();
  const query = (await searchParams).q ?? "";
  const certificates = await searchCertificates(getPrisma(), { query, take: 200 });

  return (
    <>
      <h1>Certificados</h1>
      <div className="card">
        <form className="search">
          <input type="search" name="q" defaultValue={query} placeholder="Nombre del asistente o código" aria-label="Buscar por nombre o código" />
          <button type="submit">Buscar</button>
        </form>
        <p className="muted">{query ? `Resultados para «${query}» (como mucho 200).` : "Los últimos 200 emitidos."}</p>
        <CertificateTable certificates={certificates} showAchievement empty={query ? "Ningún certificado coincide con la búsqueda." : "Todavía no hay certificados."} />
      </div>
    </>
  );
}
