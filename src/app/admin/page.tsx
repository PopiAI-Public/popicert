import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
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
    <>
      <h1>Admin de PopiCert</h1>
      <p>Has entrado como {auth.email}.</p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Formaciones</h2>
        <p className="muted">Crea una formación, emite sus certificados uno a uno o desde un CSV y copia los enlaces para enviarlos.</p>
        <Link className="button" href="/admin/formaciones">
          Ver formaciones
        </Link>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Certificados</h2>
        <p className="muted">Busca un certificado por nombre o código para revocarlo u ocultarlo.</p>
        <Link className="button" href="/admin/certificados">
          Buscar certificados
        </Link>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Plantillas de diploma</h2>
        <p className="muted">Sube diseños SVG, configura sus campos y comprueba el PDF.</p>
        <Link className="button" href="/admin/plantillas">
          Ver plantillas
        </Link>
      </div>
      <p className="muted">
        Todas las acciones quedan en el <Link href="/admin/auditoria">registro de auditoría</Link>.
      </p>
    </>
  );
}
