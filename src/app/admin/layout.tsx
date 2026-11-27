import Link from "next/link";
import type { ReactNode } from "react";
import "./admin.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin">
      <header>
        <strong>PopiCert · Admin</strong>
        <Link href="/admin">Inicio</Link>
        <Link href="/admin/plantillas">Plantillas</Link>
      </header>
      <main>{children}</main>
    </div>
  );
}
