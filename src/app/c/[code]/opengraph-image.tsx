import { ImageResponse } from "next/og";
import { getPrisma } from "@/lib/db";
import { getPublicCertificate } from "@/lib/public/certificate";
import { formatDate, messages as t } from "@/lib/public/messages";

export const dynamic = "force-dynamic";
export const alt = "Certificado de PopiAI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * La imagen de la vista previa al compartir el enlace (LinkedIn, WhatsApp…).
 * De un certificado oculto o inexistente, una tarjeta genérica sin datos.
 */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const certificate = await getPublicCertificate(getPrisma(), (await params).code);
  const visible = certificate && certificate.state !== "hidden" ? certificate : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#1f3b4d",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, opacity: 0.85 }}>{t.siteName}</div>
        {visible ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{visible.recipientName}</div>
            <div style={{ display: "flex", fontSize: 32, marginTop: 20, opacity: 0.85 }}>{t.completed}</div>
            <div style={{ display: "flex", fontSize: 46, marginTop: 8, lineHeight: 1.2 }}>{visible.achievement.name}</div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700 }}>{t.siteName}</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, opacity: 0.85 }}>
          <span>{visible ? `${visible.issuer.name} · ${formatDate(visible.issuedAt)}` : "Open Badges 3.0"}</span>
          <span>{visible ? (visible.state === "valid" ? t.valid : t.revoked) : ""}</span>
        </div>
      </div>
    ),
    size,
  );
}
