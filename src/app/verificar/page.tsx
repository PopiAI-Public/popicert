import type { Metadata } from "next";
import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { didWebFromUrl } from "@/lib/ob/did";
import { getIssuerContext } from "@/lib/ob/issuer";
import { getPublicCertificate, verifyWithStatus } from "@/lib/public/certificate";
import { messages as t } from "@/lib/public/messages";
import { PublicShell } from "../public-shell";
import { Checks, UploadVerifier } from "./upload";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${t.verifyTitle} · ${t.siteName}`,
  description: t.verifyIntro,
};

/**
 * Verificación por código (GET, sin JavaScript) o subiendo la credencial. Tiene
 * límite de peticiones (src/proxy.ts) para que no sirva para recorrer códigos.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const code = ((await searchParams).codigo ?? "").slice(0, 40);
  let result: React.ReactNode = null;

  if (code) {
    const prisma = getPrisma();
    const certificate = await getPublicCertificate(prisma, code);
    if (!certificate) {
      result = <p className="status revoked">{t.notFound}</p>;
    } else if (certificate.state === "hidden") {
      result = <p className="status revoked">{t.hidden}</p>;
    } else {
      const report = await verifyWithStatus(prisma, await getIssuerContext(), certificate.credential);
      result = (
        <>
          <p className={`status ${report.verified ? "valid" : "revoked"}`}>
            {report.verified ? `✓ ${t.verified}` : `✕ ${t.notVerified}`}
            <small>
              {certificate.recipientName} · {certificate.achievement.name}
            </small>
          </p>
          <Checks report={report} />
          <p>
            <a href={new URL(certificate.url).pathname}>{t.viewCertificate}</a>
          </p>
        </>
      );
    }
  }

  return (
    <PublicShell>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>{t.verifyTitle}</h1>
        <p className="muted">{t.verifyIntro}</p>
        <h2 style={{ fontSize: "1.1rem" }}>{t.verifyByCode}</h2>
        <form className="inline" action="/verificar">
          <input type="text" name="codigo" defaultValue={code} placeholder={t.codePlaceholder} aria-label={t.code} maxLength={40} autoComplete="off" />
          <button className="button" type="submit">
            {t.check}
          </button>
        </form>
        {result && <div style={{ marginTop: 20 }}>{result}</div>}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t.verifyByFile}</h2>
        <UploadVerifier />
        <p className="muted" style={{ marginBottom: 0 }}>
          Emisor: <code>{didWebFromUrl(getConfig().PUBLIC_URL)}</code>
        </p>
      </div>
    </PublicShell>
  );
}
