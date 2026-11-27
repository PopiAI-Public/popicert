"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi, Notice } from "../../client";

type Status = { kind: "ok" | "error" | "warn"; text: string } | null;

/** Revocación con motivo. No tiene vuelta atrás, así que pide confirmación. */
export function RevokeForm({ certificateId, recipientName }: { certificateId: string; recipientName: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!confirm(`¿Revocar el certificado de ${recipientName}? Dejará de verificarse en todas partes y no se puede deshacer.`)) return;
    setBusy(true);
    setStatus(null);
    const result = await callApi(`/api/admin/certificados/${certificateId}/revocacion`, { json: { reason } });
    setBusy(false);
    if (!result.ok) return setStatus({ kind: "error", text: result.error });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="row">
        <label htmlFor="revoke-reason">Motivo de la revocación</label>
        <input id="revoke-reason" type="text" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nombre mal escrito; se emite uno nuevo" />
        <span className="muted">Se guarda en el registro y se mostrará en la página pública del certificado.</span>
      </div>
      <Notice status={status} />
      <button type="submit" className="danger" disabled={busy}>
        {busy ? "Revocando…" : "Revocar"}
      </button>
    </form>
  );
}

/** Ocultar a petición del asistente (RGPD), o volver a mostrar. */
export function HideForm({ certificateId, hidden }: { certificateId: string; hidden: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setStatus(null);
    const result = hidden
      ? await callApi(`/api/admin/certificados/${certificateId}/ocultacion`, { method: "DELETE" })
      : await callApi(`/api/admin/certificados/${certificateId}/ocultacion`, { json: { reason } });
    setBusy(false);
    if (!result.ok) return setStatus({ kind: "error", text: result.error });
    setReason("");
    router.refresh();
  }

  if (hidden) {
    return (
      <div>
        <Notice status={status} />
        <button type="button" className="secondary" disabled={busy} onClick={() => run()}>
          {busy ? "Guardando…" : "Volver a mostrarlo"}
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={run}>
      <div className="row">
        <label htmlFor="hide-reason">Motivo</label>
        <input id="hide-reason" type="text" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lo pidió por email el 3 de diciembre" />
        <span className="muted">La página pública dejará de enseñar sus datos. La credencial sigue siendo válida.</span>
      </div>
      <Notice status={status} />
      <button type="submit" className="secondary" disabled={busy}>
        {busy ? "Ocultando…" : "Ocultar"}
      </button>
    </form>
  );
}
