/**
 * Campos de una plantilla: los marcadores `{{campo}}` de sus textos.
 *
 * Cada campo se configura en el admin: si es de la formación (igual para todos
 * los asistentes) o del asistente (va en el CSV), si es obligatorio y si es
 * público (sale en la página del certificado y en la credencial, o solo en el PDF).
 * `{{codigo}}` y `{{url}}` están reservados: los rellena PopiCert.
 */
import { z } from "zod";
import type { Document } from "@xmldom/xmldom";
import { TemplateError } from "./errors";
import { childNodes, descendants, SVG_NS, TEXT_NODE, CDATA_SECTION_NODE } from "./sanitize";

export const FIELD_MARKER = /\{\{\s*([^{}]*?)\s*\}\}/g;
export const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const RESERVED_FIELDS = ["codigo", "url"] as const;
export const QR_ELEMENT_ID = "qr";
/** Longitud máxima de un valor, para que nadie meta un texto infinito en el diploma. */
export const MAX_VALUE_LENGTH = 200;

export type ReservedField = (typeof RESERVED_FIELDS)[number];
export type FieldScope = "training" | "attendee";

export const fieldConfigSchema = z.object({
  key: z.string().regex(FIELD_KEY),
  label: z.string().trim().min(1).max(60),
  scope: z.enum(["training", "attendee"]),
  required: z.boolean(),
  public: z.boolean(),
});
export type FieldConfig = z.infer<typeof fieldConfigSchema>;

type FieldDefaults = Omit<FieldConfig, "key">;

/** Valores por defecto de los campos habituales; el resto se ajusta en el admin. */
const KNOWN_FIELDS: Record<string, FieldDefaults> = {
  nombre: { label: "Nombre", scope: "attendee", required: true, public: true },
  dni: { label: "DNI", scope: "attendee", required: false, public: false },
  empresa: { label: "Empresa", scope: "attendee", required: false, public: false },
  formacion: { label: "Formación", scope: "training", required: true, public: true },
  horas: { label: "Horas", scope: "training", required: true, public: true },
  fecha: { label: "Fecha", scope: "training", required: true, public: true },
  lugar: { label: "Lugar", scope: "training", required: false, public: true },
  ponente: { label: "Ponente", scope: "training", required: false, public: true },
  modalidad: { label: "Modalidad", scope: "training", required: false, public: true },
};

export function isReservedField(key: string): key is ReservedField {
  return (RESERVED_FIELDS as readonly string[]).includes(key);
}

export interface DetectedMarkers {
  /** Campos a configurar, en orden de aparición y sin los reservados. */
  fields: string[];
  reserved: ReservedField[];
  /** Avisos sobre marcadores que no se pueden usar tal cual. */
  warnings: string[];
}

/** Nodos de texto dentro de elementos <text> (y sus <tspan>/<textPath>). */
export function textNodesInText(document: Document) {
  const textElements = descendants(document.documentElement!).filter(
    (el) => el.namespaceURI === SVG_NS && el.localName === "text",
  );
  return textElements.flatMap((text) =>
    [text, ...descendants(text)].flatMap((el) =>
      childNodes(el).filter((n) => n.nodeType === TEXT_NODE || n.nodeType === CDATA_SECTION_NODE),
    ),
  );
}

export function detectMarkers(document: Document): DetectedMarkers {
  const fields: string[] = [];
  const reserved = new Set<ReservedField>();
  const warnings = new Set<string>();

  for (const node of textNodesInText(document)) {
    const text = node.nodeValue ?? "";
    for (const match of text.matchAll(FIELD_MARKER)) {
      const raw = match[1]!;
      const key = raw.toLowerCase();
      if (key === QR_ELEMENT_ID) {
        warnings.add('{{qr}} no es un texto: marca el sitio del QR con un rectángulo con id="qr".');
      } else if (!FIELD_KEY.test(key)) {
        warnings.add(
          `El marcador {{${raw}}} no es válido: usa solo letras sin tildes, números y guiones bajos, por ejemplo {{${suggestKey(raw)}}}.`,
        );
      } else if (isReservedField(key)) {
        reserved.add(key);
      } else if (!fields.includes(key)) {
        fields.push(key);
      }
    }
    const leftovers = text.replace(FIELD_MARKER, "");
    if (leftovers.includes("{{") || leftovers.includes("}}")) {
      warnings.add(
        `Hay un marcador partido en «${text.trim().slice(0, 40)}»: cada {{campo}} tiene que estar entero dentro del mismo texto, sin cambios de estilo en medio.`,
      );
    }
  }
  return { fields, reserved: [...reserved], warnings: [...warnings] };
}

function suggestKey(raw: string): string {
  const key = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(key) ? key.slice(0, 40) : `campo_${key}`.slice(0, 40);
}

export function defaultFieldConfig(key: string): FieldConfig {
  const known = KNOWN_FIELDS[key];
  if (known) return { key, ...known };
  const label = key.replace(/_/g, " ");
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1), scope: "attendee", required: true, public: false };
}

/** Configuración para los campos detectados: la anterior si ya existía, si no la de por defecto. */
export function mergeFieldConfig(detected: string[], previous: readonly FieldConfig[] = []): FieldConfig[] {
  return detected.map((key) => previous.find((f) => f.key === key) ?? defaultFieldConfig(key));
}

/** Comprueba que una configuración cubre exactamente los campos de la plantilla. */
export function validateFieldConfig(detected: readonly string[], input: unknown): FieldConfig[] {
  const parsed = z.array(fieldConfigSchema).safeParse(input);
  if (!parsed.success) throw new TemplateError("La configuración de los campos no es válida.");
  const config = parsed.data;
  const keys = config.map((f) => f.key);
  if (new Set(keys).size !== keys.length) throw new TemplateError("Hay campos repetidos en la configuración.");
  const missing = detected.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !detected.includes(k));
  if (missing.length || extra.length) {
    throw new TemplateError(
      `La configuración no coincide con los campos de la plantilla${missing.length ? `; faltan: ${missing.join(", ")}` : ""}${extra.length ? `; sobran: ${extra.join(", ")}` : ""}.`,
    );
  }
  return detected.map((key) => config.find((f) => f.key === key)!);
}

/** Limpia un valor: sin caracteres de control, espacios normalizados y en forma NFC. */
export function normalizeFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Valores finales de todos los marcadores: los de los campos configurados
 * más los reservados. Falla con todos los problemas a la vez.
 */
export function resolveFieldValues(
  fields: readonly FieldConfig[],
  values: Readonly<Record<string, unknown>>,
  reserved: Readonly<Record<ReservedField, string>>,
): Map<string, string> {
  const result = new Map<string, string>();
  const problems: string[] = [];
  for (const field of fields) {
    const value = normalizeFieldValue(values[field.key]);
    if (field.required && !value) problems.push(`falta «${field.label}»`);
    if (value.length > MAX_VALUE_LENGTH) problems.push(`«${field.label}» tiene más de ${MAX_VALUE_LENGTH} caracteres`);
    result.set(field.key, value);
  }
  if (problems.length) throw new TemplateError(`Datos incompletos: ${problems.join("; ")}.`);
  for (const key of RESERVED_FIELDS) result.set(key, normalizeFieldValue(reserved[key]));
  return result;
}

export function replaceMarkers(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(FIELD_MARKER, (marker, raw: string) => {
    const value = values.get(raw.toLowerCase());
    return value ?? marker;
  });
}

