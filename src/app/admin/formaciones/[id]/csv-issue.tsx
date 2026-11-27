"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { callApi, CopyButton, Notice } from "../../client";

type RowStatus = "ok" | "existing" | "error" | "issued";

interface BatchRow {
  line: number;
  name: string;
  status: RowStatus;
  messages: string[];
  certificate?: { id: string; code: string; url: string; recipientName: string };
}

interface BatchReport {
  rows: BatchRow[];
  ignoredColumns: string[];
  counts: Record<RowStatus, number>;
}

const STATUS_LABEL: Record<RowStatus, string> = { ok: "Se emitirá", existing: "Ya tiene certificado", error: "Error", issued: "Emitido" };

/** Fila para pegar en una hoja de cálculo: nombre, enlace y código, separados por tabuladores. */
function batchTsv(rows: readonly BatchRow[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  return [
    "Nombre\tEnlace\tCódigo",
    ...rows.filter((r) => r.certificate).map((r) => [clean(r.name), r.certificate!.url, r.certificate!.code].join("\t")),
  ].join("\n");
}

/**
 * Emisión desde un CSV en dos pasos: vista previa con la validación fila a
 * fila, y confirmación. La confirmación vuelve a validar en el servidor.
 */
export function CsvIssue({ achievementId }: { achievementId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BatchReport | null>(null);
  const [result, setResult] = useState<BatchReport | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<"preview" | "issue" | null>(null);

  async function send(kind: "preview" | "issue") {
    if (!file) return;
    setBusy(kind);
    setStatus(null);
    const form = new FormData();
    form.set("csv", file);
    const response = await callApi<BatchReport>(`/api/admin/formaciones/${achievementId}/csv/${kind === "preview" ? "vista-previa" : "emitir"}`, { body: form });
    setBusy(null);
    if (!response.ok) return setStatus({ kind: "error", text: response.error });
    if (kind === "preview") {
      setPreview(response.data);
      setResult(null);
    } else {
      setResult(response.data);
      setPreview(null);
      const c = response.data.counts;
      setStatus({ kind: c.error ? "warn" : "ok", text: `Emitidos: ${c.issued}. Ya existentes: ${c.existing}. Con error: ${c.error}.` });
      router.refresh();
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setStatus(null);
    if (input.current) input.current.value = "";
  }

  const report = result ?? preview;

  return (
    <div>
      <div className="row">
        <label htmlFor="csv">CSV de asistentes</label>
        <input
          ref={input}
          id="csv"
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setResult(null);
            setStatus(null);
          }}
        />
        <span className="muted">
          Una fila por asistente. Separado por comas o por punto y coma, como lo guarde la hoja de cálculo.{" "}
          <a href={`/api/admin/formaciones/${achievementId}/csv/ejemplo.csv`}>Descargar un CSV de ejemplo</a> con las columnas de esta formación.
        </span>
      </div>
      <div className="actions">
        <button type="button" className="secondary" disabled={!file || busy !== null} onClick={() => send("preview")}>
          {busy === "preview" ? "Comprobando…" : "Comprobar el CSV"}
        </button>
        {preview && (
          <button
            type="button"
            disabled={busy !== null || preview.counts.ok === 0}
            onClick={() =>
              (preview.counts.error === 0 || confirm(`Hay ${preview.counts.error} fila(s) con errores que no se emitirán. ¿Emitir las demás?`)) && send("issue")
            }
          >
            {busy === "issue" ? "Emitiendo…" : `Emitir ${preview.counts.ok} certificado${preview.counts.ok === 1 ? "" : "s"}`}
          </button>
        )}
        {(preview || result) && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={reset}>
            Empezar de nuevo
          </button>
        )}
      </div>
      <Notice status={status} />

      {report && (
        <>
          {preview && (
            <p className="muted">
              {preview.counts.ok} se emitirán, {preview.counts.existing} ya tienen certificado y {preview.counts.error} tienen errores. Todavía no se ha emitido nada.
            </p>
          )}
          {report.ignoredColumns.length > 0 && (
            <p className="notice warn">Columnas que no son de la plantilla y se ignoran: {report.ignoredColumns.join(", ")}.</p>
          )}
          {result && result.rows.some((r) => r.certificate) && (
            <p className="actions">
              <CopyButton text={batchTsv(result.rows)} label="Copiar nombres y enlaces" className="small" />
              <span className="muted">Se pegan como columnas en una hoja de cálculo, o tal cual en un email.</span>
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Línea</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.line} className={`row-${row.status}`}>
                    <td>{row.line}</td>
                    <td>{row.name || <span className="muted">(vacío)</span>}</td>
                    <td>
                      <span className={`badge status-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                    </td>
                    <td>
                      {row.messages.join(" ")}{" "}
                      {row.certificate && (
                        <>
                          <a href={`/admin/certificados/${row.certificate.id}`}>{row.certificate.code}</a> <CopyButton text={row.certificate.url} label="Copiar enlace" />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
