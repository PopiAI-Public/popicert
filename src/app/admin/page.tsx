import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { authenticateAdmin } from "@/lib/security/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · PopiCert",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  // Segunda barrera, además del proxy: sin admin autenticado, la página no existe.
  const auth = await authenticateAdmin(await headers());
  if (!auth.ok) notFound();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px", lineHeight: 1.5 }}>
      <h1>Admin de PopiCert</h1>
      <p>Has entrado como {auth.email}.</p>
      <p>Aquí estarán las formaciones, la emisión y la revocación de certificados.</p>
    </main>
  );
}
