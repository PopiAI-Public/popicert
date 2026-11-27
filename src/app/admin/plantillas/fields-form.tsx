"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FieldConfig } from "@/lib/templates/fields";

/** Configuración de los campos de una versión: de quién es cada dato, si es obligatorio y si es público. */
export function FieldsForm({ versionId, initial, locked }: { versionId: string; initial: FieldConfig[]; locked: boolean }) {
  const router = useRouter();
  const [fields, setFields] = useState(initial);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<FieldConfig>) =>
    setFields((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/admin/plantillas/versiones/${versionId}/campos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setStatus({ kind: "error", text: body.error ?? `No se pudo guardar (error ${response.status}).` });
        return;
      }
      setStatus({ kind: "ok", text: "Guardado." });
      router.refresh();
    } catch {
      setStatus({ kind: "error", text: "No se pudo conectar con el servidor." });
    } finally {
      setBusy(false);
    }
  }

  if (fields.length === 0) return <p className="muted">Esta plantilla no tiene campos.</p>;

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Marcador</th>
              <th>Nombre en el admin</th>
              <th>De quién es</th>
              <th>Obligatorio</th>
              <th>Público</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.key}>
                <td>
                  <code>{`{{${field.key}}}`}</code>
                </td>
                <td>
                  <input
                    type="text"
                    aria-label={`Nombre de ${field.key}`}
                    value={field.label}
                    maxLength={60}
                    disabled={locked}
                    onChange={(e) => update(field.key, { label: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`De quién es ${field.key}`}
                    value={field.scope}
                    disabled={locked}
                    onChange={(e) => update(field.key, { scope: e.target.value as FieldConfig["scope"] })}
                  >
                    <option value="training">De la formación (igual para todos)</option>
                    <option value="attendee">Del asistente (va en el CSV)</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${field.key} es obligatorio`}
                    checked={field.required}
                    disabled={locked}
                    onChange={(e) => update(field.key, { required: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${field.key} es público`}
                    checked={field.public}
                    disabled={locked}
                    onChange={(e) => update(field.key, { public: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        «Público» quiere decir que el dato sale en la página del certificado y en la credencial verificable. Si no, solo va en el PDF.
      </p>
      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}
      {!locked && (
        <button type="button" onClick={save} disabled={busy}>
          {busy ? "Guardando…" : "Guardar campos"}
        </button>
      )}
    </div>
  );
}
