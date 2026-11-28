import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { getPublicCertificate, linkedInUrl } from "@/lib/public/certificate";
import { formatDate, messages as t } from "@/lib/public/messages";
import { PublicShell, Qr } from "../../public-shell";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

const load = cache(async (code: string) => getPublicCertificate(getPrisma(), code));

/**
 * Metadatos para que el enlace se vea bien al compartirlo (LinkedIn, WhatsApp…).
 * Se generan en el servidor: los robots que hacen la vista previa no ejecutan
 * JavaScript. Las URL salen siempre de PUBLIC_URL, nunca del Host de la petición.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const config = getConfig();
  const certificate = await load((await params).code);
  const base: Metadata = { metadataBase: new URL(config.PUBLIC_URL), robots: { index: false, follow: false } };
  if (!certificate) return { ...base, title: `${t.notFoundTitle} · ${t.siteName}` };
  if (certificate.state === "hidden") return { ...base, title: `${t.hiddenTitle} · ${t.siteName}` };

  const title = `${certificate.recipientName} · ${certificate.achievement.name}`;
  const description = `${certificate.recipientName} ${t.completed} «${certificate.achievement.name}». ${t.issuedBy} ${certificate.issuer.name}.`;
  return {
    ...base,
    title,
    description,
    alternates: { canonical: certificate.url },
    openGraph: { type: "website", url: certificate.url, siteName: t.siteName, title, description, locale: "es_ES" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CertificatePage({ params }: Props) {
  const certificate = await load((await params).code);
  if (!certificate) notFound();

  if (certificate.state === "hidden") {
    return (
      <PublicShell>
        <div className="card">
          <h1>{t.hiddenTitle}</h1>
          <p>{t.hidden}</p>
          <a className="button secondary" href="/verificar">
            {t.verify}
          </a>
        </div>
      </PublicShell>
    );
  }

  const valid = certificate.state === "valid";
  const base = `/c/${certificate.code}`;
  return (
    <PublicShell>
      <article className="card">
        <p className={`status ${certificate.state}`} role="status">
          {valid ? `✓ ${t.valid}` : `✕ ${t.revoked}`}
          {!valid && certificate.revokedAt && (
            <small>
              {t.revokedOn(formatDate(certificate.revokedAt))} {certificate.revocationReason && `${t.reason}: ${certificate.revocationReason}`}
            </small>
          )}
        </p>
        <div className="head">
          <div>
            <h1 className="recipient">{certificate.recipientName}</h1>
            <p className="completed">{t.completed}</p>
            <h2 className="achievement">{certificate.achievement.name}</h2>
          </div>
          {certificate.achievement.image && (
            // eslint-disable-next-line @next/next/no-img-element -- imagen propia, servida inmutable desde /insignias
            <img className="badge-image" src={new URL(certificate.achievement.image).pathname} alt="" />
          )}
        </div>
        <p>{certificate.achievement.description}</p>

        <dl>
          <dt>{t.issuedBy}</dt>
          <dd>{certificate.issuer.url ? <a href={certificate.issuer.url}>{certificate.issuer.name}</a> : certificate.issuer.name}</dd>
          <dt>{t.issuedOn}</dt>
          <dd>{formatDate(certificate.issuedAt)}</dd>
          {certificate.fields.map((field) => (
            <FieldRow key={field.label} label={field.label} value={field.value} />
          ))}
          <dt>{t.criteria}</dt>
          <dd>{certificate.achievement.criteria}</dd>
          <dt>{t.code}</dt>
          <dd>
            <code>{certificate.code}</code>
          </dd>
        </dl>

        <div className="actions">
          <a className="button" href={`${base}/certificado.pdf`}>
            {t.downloadPdf}
          </a>
          <a className="button secondary" href={`${base}/credencial.json`} download={`certificado-${certificate.code}.json`}>
            {t.downloadJson}
          </a>
          {valid && (
            <a className="button linkedin" href={linkedInUrl(certificate, getConfig().LINKEDIN_ORGANIZATION_ID)} target="_blank" rel="noopener noreferrer">
              {t.addToLinkedIn}
            </a>
          )}
        </div>
      </article>

      <section className="card qr-row">
        <Qr text={certificate.url} label={t.qrAlt} />
        <div>
          <p style={{ marginTop: 0 }}>
            <code>{certificate.url}</code>
          </p>
          <a href={`/verificar?codigo=${certificate.code}`}>{t.verify}</a>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t.aboutTitle}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {t.about}
        </p>
      </section>
    </PublicShell>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
