"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { FieldConfig } from "@/lib/templates/fields";
import { callApi, CopyButton, Notice } from "../../client";

type Status = { kind: "ok" | "error" | "warn"; text: string } | null;

/** Imagen de la insignia (PNG o JPEG). */
export function BadgeForm({ achievementId, disabled }: { achievementId: string; disabled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const result = await callApi(`/api/admin/formaciones/${achievementId}/insignia`, { method: "PUT", body: new FormData(event.currentTarget) });
    setBusy(false);
    if (!result.ok) return setStatus({ kind: "error", text: result.error });
    setStatus({ kind: "ok", text: "Insignia guardada. Los certificados ya emitidos conservan la suya." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="row">
        <label htmlFor="badge">Imagen de la insignia (PNG o JPEG, cuadrada, hasta 1 MB)</label>
        <input id="badge" name="image" type="file" accept="image/png,image/jpeg" required disabled={disabled} />
      </div>
      <Notice status={status} />
      <button type="submit" className="secondary" disabled={busy || disabled}>
        {busy ? "Subiendo…" : "Subir insignia"}
      </button>
    </form>
  );
}

/** Archivar, recuperar o borrar la formación. */
export function ArchiveControls({ achievementId, archived, issuedCount }: { achievementId: string; archived: boolean; issuedCount: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function run(method: "PUT" | "DELETE", url: string, after: () => void) {
    setBusy(true);
    setStatus(null);
    const result = await callApi(url, { method });
    setBusy(false);
    if (!result.ok) return setStatus({ kind: "error", text: result.error });
    after();
  }

  return (
    <div>
      <div className="actions">
        {archived ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => run("DELETE", `/api/admin/formaciones/${achievementId}/archivada`, () => router.refresh())}>
            Recuperar la formación
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => confirm("¿Archivar la formación? No se podrán emitir más certificados hasta que la recuperes.") && run("PUT", `/api/admin/formaciones/${achievementId}/archivada`, () => router.refresh())}
          >
            Archivar
          </button>
        )}
        {issuedCount === 0 && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => confirm("¿Borrar la formación? No tiene certificados, así que no se pierde nada emitido.") && run("DELETE", `/api/admin/formaciones/${achievementId}`, () => router.push("/admin/formaciones"))}
          >
            Borrar
          </button>
        )}
      </div>
      {issuedCount > 0 && <p className="muted">Tiene certificados emitidos: no se puede borrar, solo archivar.</p>}
      <Notice status={status} />
    </div>
  );
}

interface IssuedCertificate {
  id: string;
  code: string;
  url: string;
  recipientName: string;
}

/** Emisión individual, con un campo por cada dato del asistente de la plantilla. */
export function IssueForm({ achievementId, fields }: { achievementId: string; fields: FieldConfig[] }) {
  const router = useRouter();
  const empty = () => Object.fromEntries(fields.map((f) => [f.key, ""]));
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [issued, setIssued] = useState<IssuedCertificate | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setIssued(null);
    const result = await callApi<{ status: "issued" | "existing"; certificate: IssuedCertificate }>(`/api/admin/formaciones/${achievementId}/certificados`, {
      json: { values, email },
    });
    setBusy(false);
    if (!result.ok) return setStatus({ kind: "error", text: result.error });
    setIssued(result.data.certificate);
    if (result.data.status === "existing") {
      setStatus({ kind: "warn", text: `${result.data.certificate.recipientName} ya tenía certificado en esta formación: no se ha emitido otro.` });
    } else {
      setStatus({ kind: "ok", text: `Certificado emitido para ${result.data.certificate.recipientName}.` });
      setValues(empty());
      setEmail("");
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      {fields.map((field) => (
        <div className="row" key={field.key}>
          <label htmlFor={`i-${field.key}`}>
            {field.label}
            {field.required ? "" : " (opcional)"} {!field.public && <span className="badge">solo en el PDF</span>}
          </label>
          <input
            id={`i-${field.key}`}
            type="text"
            maxLength={200}
            required={field.required}
            value={values[field.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="row">
        <label htmlFor="i-email">Email (opcional)</label>
        <input id="i-email" type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
        <span className="muted">En la credencial solo va con hash: sirve para que el asistente pueda demostrar que es suya.</span>
      </div>
      <Notice status={status} />
      {issued && (
        <p className="actions">
          <a href={`/admin/certificados/${issued.id}`}>{issued.code}</a>
          <code>{issued.url}</code>
          <CopyButton text={issued.url} label="Copiar enlace" />
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Emitiendo…" : "Emitir certificado"}
      </button>
    </form>
  );
}
