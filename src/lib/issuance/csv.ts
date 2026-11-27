/**
 * CSV de asistentes: lectura (RFC 4180, con el separador que use la hoja de
 * cálculo) y escritura de las exportaciones.
 *
 * Excel en español guarda los CSV con `;`, Google Sheets y Numbers con `,`, y
 * a veces llega pegado con tabuladores: se detecta mirando la cabecera.
 */
import { normalizeName } from "./dedupe";
import { IssuanceError } from "./errors";
import type { FieldConfig } from "@/lib/templates/fields";

export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 500;

/** Columna opcional con el email del asistente. No es un campo de la plantilla. */
export const EMAIL_COLUMN = "email";
const EMAIL_ALIASES = ["email", "e mail", "correo", "correo electronico", "mail"];

const DELIMITERS = [",", ";", "\t"] as const;
type Delimiter = (typeof DELIMITERS)[number];

function detectDelimiter(text: string): Delimiter {
  // Solo la primera línea lógica, sin contar lo que va entre comillas.
  let inQuotes = false;
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && char in counts) counts[char as Delimiter]++;
  }
  return DELIMITERS.reduce((best, d) => (counts[d] > counts[best] ? d : best), ",");
}

export interface ParsedCsv {
  header: string[];
  /** Filas con su número de línea en el fichero (la cabecera es la 1). */
  rows: { line: number; cells: string[] }[];
}

/** Lee un CSV. Las filas vacías se ignoran; una comilla sin cerrar es un error. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += char;
    }
  }
  if (inQuotes) throw new IssuanceError(`El CSV tiene unas comillas sin cerrar (desde la línea ${recordLine}).`);
  endRecord();

  const [header, ...rows] = records;
  if (!header) throw new IssuanceError("El CSV está vacío.");
  return { header: header.cells.map((c) => c.trim()), rows };
}

/** Cabecera normalizada para compararla con las claves y los nombres de los campos. */
function normalizeHeader(value: string): string {
  return normalizeName(value.replace(/_/g, " "));
}

export interface ColumnMapping {
  /** Índice de la columna de cada campo del asistente que aparece en el CSV. */
  fields: Map<string, number>;
  email: number | null;
  /** Columnas que no corresponden a ningún campo: se ignoran. */
  ignored: string[];
}

/**
 * Asocia las columnas a los campos del asistente, por su clave (`nombre`) o
 * por su nombre en el admin («Nombre y apellidos»), sin importar mayúsculas ni
 * tildes. Faltar una columna obligatoria es un error de todo el CSV.
 */
export function mapColumns(header: readonly string[], attendeeFields: readonly FieldConfig[]): ColumnMapping {
  const fields = new Map<string, number>();
  let email: number | null = null;
  const ignored: string[] = [];

  header.forEach((raw, index) => {
    const name = normalizeHeader(raw);
    if (!name) return;
    const field = attendeeFields.find((f) => normalizeHeader(f.key) === name || normalizeHeader(f.label) === name);
    if (field) {
      if (fields.has(field.key)) throw new IssuanceError(`La columna de «${field.label}» está repetida en el CSV.`);
      fields.set(field.key, index);
    } else if (EMAIL_ALIASES.includes(name)) {
      if (email !== null) throw new IssuanceError("La columna del email está repetida en el CSV.");
      email = index;
    } else {
      ignored.push(raw);
    }
  });

  const missing = attendeeFields.filter((f) => f.required && !fields.has(f.key));
  if (missing.length) {
    throw new IssuanceError(
      `Faltan columnas en el CSV: ${missing.map((f) => `«${f.key}» (${f.label})`).join(", ")}. Descarga el CSV de ejemplo para ver las columnas.`,
    );
  }
  return { fields, email, ignored };
}

export interface CsvAttendee {
  line: number;
  values: Record<string, string>;
  email?: string;
}

export function csvAttendees(parsed: ParsedCsv, mapping: ColumnMapping): CsvAttendee[] {
  if (parsed.rows.length > MAX_CSV_ROWS) {
    throw new IssuanceError(`El CSV tiene ${parsed.rows.length} filas; como mucho se pueden emitir ${MAX_CSV_ROWS} de una vez.`);
  }
  return parsed.rows.map(({ line, cells }) => {
    const values: Record<string, string> = {};
    for (const [key, index] of mapping.fields) values[key] = cells[index] ?? "";
    const email = mapping.email === null ? "" : (cells[mapping.email] ?? "").trim();
    return { line, values, ...(email ? { email } : {}) };
  });
}

/**
 * Un valor que empieza por `=`, `+`, `-`, `@` o un tabulador lo ejecuta Excel
 * como fórmula al abrir el CSV. Se le pone delante un apóstrofo, que la hoja de
 * cálculo no enseña, para que se quede en texto.
 */
function protectFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: string, delimiter: string): string {
  const safe = protectFormula(value);
  return /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV para descargar. Con `;` y BOM, que es lo que Excel en español abre bien
 * con doble clic; Google Sheets lo detecta solo al importarlo.
 */
export function toCsv(rows: readonly (readonly string[])[], delimiter = ";"): string {
  return "﻿" + rows.map((row) => row.map((cell) => escapeCell(cell, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}

/** Texto separado por tabuladores, para pegar en una hoja de cálculo o en un email. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((cell) => protectFormula(cell.replace(/[\t\r\n]+/g, " "))).join("\t")).join("\n");
}
