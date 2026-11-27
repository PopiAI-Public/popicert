"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Subida de una plantilla nueva o de una versión nueva de una existente. */
export function UploadForm({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = templateId ? `/api/admin/plantillas/${templateId}/versiones` : "/api/admin/plantillas";
      const response = await fetch(url, { method: "POST", body: new FormData(event.currentTarget) });
      const body = (await response.json().catch(() => ({}))) as { versionId?: string; error?: string };
      if (!response.ok || !body.versionId) {
        setError(body.error ?? `No se pudo subir la plantilla (error ${response.status}).`);
        return;
      }
      router.push(`/admin/plantillas/${body.versionId}`);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {!templateId && (
        <div className="row">
          <label htmlFor="name">Nombre</label>
          <input id="name" name="name" type="text" required maxLength={120} placeholder="Diploma estándar" />
        </div>
      )}
      <div className="row">
        <label htmlFor="svg">Diseño (SVG, A4)</label>
        <input id="svg" name="svg" type="file" accept=".svg,image/svg+xml" required />
      </div>
      <div className="row">
        <label htmlFor="fonts">Fuentes que usa (TTF, OTF o WOFF; opcional)</label>
        <input id="fonts" name="fonts" type="file" accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff" multiple />
        <span className="muted">Sin fuentes se usan Helvetica, Times o Courier, que solo cubren los caracteres del español y del resto de Europa occidental.</span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Comprobando…" : templateId ? "Subir versión nueva" : "Subir plantilla"}
      </button>
    </form>
  );
}
