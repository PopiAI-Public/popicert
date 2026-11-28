import Link from "next/link";
import type { ReactNode } from "react";
import { qrPath } from "@/lib/templates/qr";
import { messages as t } from "@/lib/public/messages";
import "./public.css";

/** Marco común de las páginas públicas. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public">
      <header className="site">
        <Link href="/">{t.siteName}</Link>
      </header>
      <main>{children}</main>
      <footer className="site">
        <p>{t.privacy}</p>
      </footer>
    </div>
  );
}

/** QR vectorial en el propio HTML: no depende de imágenes ni de scripts. */
export function Qr({ text, label }: { text: string; label: string }) {
  const { size, d } = qrPath(text);
  const margin = 2;
  return (
    <svg className="qr" viewBox={`${-margin} ${-margin} ${size + 2 * margin} ${size + 2 * margin}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-margin} y={-margin} width={size + 2 * margin} height={size + 2 * margin} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
