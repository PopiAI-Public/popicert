"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TemplateChoice } from "@/lib/issuance/achievements";
import { callApi, Notice } from "../client";

export interface AchievementFormValues {
  name: string;
  description: string;
  criteria: string;
  hours: number | null;
  templateVersionId: string;
  trainingValues: Record<string, string>;
}

/** Campos que, vacíos, se rellenan con los datos de la formación. */
const DERIVED: Record<string, string> = { formacion: "el nombre de la formación", horas: "las horas de la formación" };

/** Alta y edición de una formación: datos del `Achievement`, plantilla y valores de sus campos de formación. */
export function AchievementForm({
  achievementId,
  initial,
  templates,
  issuedCount = 0,
}: {
  achievementId?: string;
  initial?: AchievementFormValues;
  templates: TemplateChoice[];
  issuedCount?: number;
}) {
  const router = useRouter();
  const usable = templates.filter((t) => !t.problem);
  const [values, setValues] = useState<AchievementFormValues>(
    initial ?? { name: "", description: "", criteria: "", hours: null, templateVersionId: usable[0]?.versionId ?? "", trainingValues: {} },
  );
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const template = templates.find((t) => t.versionId === values.templateVersionId);
  const trainingFields = template?.fields.filter((f) => f.scope === "training") ?? [];
  const attendeeFields = template?.fields.filter((f) => f.scope === "attendee") ?? [];

  const set = <K extends keyof AchievementFormValues>(key: K, value: AchievementFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const result = await callApi<{ achievement: { id: string } }>(achievementId ? `/api/admin/formaciones/${achievementId}` : "/api/admin/formaciones", {
      method: achievementId ? "PUT" : "POST",
      json: values,
    });
    setBusy(false);
    if (!result.ok) {
      setStatus({ kind: "error", text: result.error });
      return;
    }
    if (achievementId) {
      setStatus({ kind: "ok", text: "Guardado." });
      router.refresh();
    } else {
      router.push(`/admin/formaciones/${result.data.achievement.id}`);
    }
  }

  if (templates.length === 0) {
    return (
      <p className="muted">
        Antes de crear una formación hace falta una plantilla de diploma: <Link href="/admin/plantillas">sube una</Link>.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {achievementId && issuedCount > 0 && (
        <p className="notice warn">
          Ya hay {issuedCount} certificado{issuedCount === 1 ? "" : "s"} emitido{issuedCount === 1 ? "" : "s"}: los cambios solo afectan a los que se emitan a partir de ahora.
        </p>
      )}
      <div className="row">
        <label htmlFor="a-name">Nombre de la formación</label>
        <input id="a-name" type="text" required maxLength={200} value={values.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="row">
        <label htmlFor="a-description">Descripción</label>
        <textarea id="a-description" required maxLength={2000} rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
        <span className="muted">Va en la credencial y en la página pública del certificado.</span>
      </div>
      <div className="row">
        <label htmlFor="a-criteria">Criterios para obtenerlo</label>
        <textarea
          id="a-criteria"
          required
          maxLength={2000}
          rows={2}
          placeholder="Asistir a la formación completa."
          value={values.criteria}
          onChange={(e) => set("criteria", e.target.value)}
        />
      </div>
      <div className="row">
        <label htmlFor="a-hours">Horas</label>
        <input
          id="a-hours"
          type="number"
          min={1}
          max={10000}
          step={1}
          value={values.hours ?? ""}
          onChange={(e) => set("hours", e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
      <div className="row">
        <label htmlFor="a-template">Plantilla de diploma</label>
        <select id="a-template" required value={values.templateVersionId} onChange={(e) => set("templateVersionId", e.target.value)}>
          {!template && <option value="">Elige una plantilla</option>}
          {templates.map((t) => (
            <option key={t.versionId} value={t.versionId} disabled={Boolean(t.problem)}>
              {t.label}
              {t.problem ? " (no sirve: falta {{nombre}} del asistente)" : ""}
            </option>
          ))}
        </select>
        {attendeeFields.length > 0 && (
          <span className="muted">Del asistente (irán en el CSV): {attendeeFields.map((f) => `${f.label}${f.required ? "" : " (opcional)"}`).join(", ")}.</span>
        )}
      </div>

      {trainingFields.length > 0 && (
        <fieldset>
          <legend>Datos de la formación que van en el diploma</legend>
          {trainingFields.map((field) => (
            <div className="row" key={field.key}>
              <label htmlFor={`t-${field.key}`}>
                {field.label}
                {field.required && !DERIVED[field.key] ? "" : " (opcional)"} {field.public ? "" : <span className="badge">solo en el PDF</span>}
              </label>
              <input
                id={`t-${field.key}`}
                type="text"
                maxLength={200}
                required={field.required && !DERIVED[field.key]}
                placeholder={DERIVED[field.key] ? `Si lo dejas vacío, ${DERIVED[field.key]}` : undefined}
                value={values.trainingValues[field.key] ?? ""}
                onChange={(e) => set("trainingValues", { ...values.trainingValues, [field.key]: e.target.value })}
              />
            </div>
          ))}
        </fieldset>
      )}

      <Notice status={status} />
      <button type="submit" disabled={busy}>
        {busy ? "Guardando…" : achievementId ? "Guardar cambios" : "Crear formación"}
      </button>
    </form>
  );
}
