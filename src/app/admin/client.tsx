"use client";

import { useState } from "react";

/** Llama a la API del admin y devuelve el cuerpo o un mensaje de error para enseñarlo. */
export async function callApi<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; json?: unknown; body?: BodyInit } = {},
): Promise<{ ok: true; data: T; status: number } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    if (response.status === 204) return { ok: true, data: {} as T, status: 204 };
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      const error = response.status === 403 ? "La sesión de Cloudflare Access ha caducado: recarga la página." : (data.error ?? `Error ${response.status}.`);
      return { ok: false, error };
    }
    return { ok: true, data, status: response.status };
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}

/** Botón que copia un texto al portapapeles y avisa de que lo ha hecho. */
export function CopyButton({ text, label = "Copiar", className = "secondary small" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Sin permiso para el portapapeles (o sin HTTPS): el viejo truco del textarea.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? "¡Copiado!" : label}
    </button>
  );
}

export function Notice({ status }: { status: { kind: "ok" | "error" | "warn"; text: string } | null }) {
  if (!status) return null;
  return (
    <p className={`notice ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
      {status.text}
    </p>
  );
}
