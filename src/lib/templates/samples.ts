/**
 * Datos de ejemplo para las vistas previas. A propósito largos y con tildes y
 * eñes: si la plantilla aguanta esto, aguanta casi cualquier nombre real.
 */
import type { FieldConfig, ReservedField } from "./fields";

export const SAMPLE_CODE = "ABCD234567";

const SAMPLES: Record<string, string> = {
  nombre: "María José Fernández-Castañeda Núñez",
  dni: "12345678Z",
  empresa: "Peñalara Ingeniería y Diseño, S. L.",
  formacion: "Introducción a la IA generativa para equipos",
  horas: "8",
  fecha: "27 de noviembre de 2026",
  lugar: "Valencia",
  ponente: "Íñigo Güell Ortúzar",
  modalidad: "Presencial",
};

export function sampleValues(fields: readonly FieldConfig[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, SAMPLES[f.key] ?? `${f.label} de ejemplo`]));
}

export function sampleReserved(publicUrl: string): Record<ReservedField, string> {
  return { codigo: SAMPLE_CODE, url: `${publicUrl}/c/${SAMPLE_CODE}` };
}
