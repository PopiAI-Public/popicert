"use client";

import { useState } from "react";
import type { VerificationReport } from "@/lib/ob/verify";
import { messages as t } from "@/lib/public/messages";

export function Checks({ report }: { report: VerificationReport }) {
  return (
    <ul className="checks">
      {(Object.keys(t.checks) as (keyof typeof t.checks)[]).map((key) => {
        const check = report.checks[key];
        return (
          <li key={key}>
            <span>{t.checks[key]}</span>
            <span className={check.outcome}>
              {t.outcome[check.outcome]}
              {check.message ? ` — ${check.message}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Sube la credencial (JSON) y la verifica en el servidor. El fichero no se guarda. */
export function UploadVerifier() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ report: VerificationReport; page: string | null } | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      const response = await fetch("/api/verificar", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      const body = (await response.json().catch(() => ({}))) as { report?: VerificationReport; page?: string | null; error?: string };
      if (!response.ok || !body.report) setError(response.status === 429 ? "Demasiadas comprobaciones seguidas: espera un minuto." : (body.error ?? `Error ${response.status}.`));
      else setResult({ report: body.report, page: body.page ?? null });
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input type="file" accept=".json,application/json,application/ld+json" aria-label={t.verifyByFile} disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      {busy && <p className="muted">{t.checking}</p>}
      {error && (
        <p className="status revoked" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div style={{ marginTop: 16 }}>
          <p className={`status ${result.report.verified ? "valid" : "revoked"}`} role="status">
            {result.report.verified ? `✓ ${t.verified}` : `✕ ${t.notVerified}`}
          </p>
          <Checks report={result.report} />
          {result.page && (
            <p>
              <a href={new URL(result.page).pathname}>{t.viewCertificate}</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
