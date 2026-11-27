/**
 * Clave de duplicado de un asistente dentro de una formación: su DNI si la
 * plantilla lo pide y viene relleno, y si no, su nombre. Normalizados, para
 * que «José Pérez», «JOSE PEREZ» y «  josé  pérez » sean la misma persona y
 * repetir un CSV retocado a mano no emita dos veces.
 */

/** Minúsculas, sin tildes ni signos y con los espacios juntados. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Mayúsculas, sin espacios, puntos ni guiones: «12.345.678-z» → «12345678Z». */
export function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[\s.\-_/]/g, "");
}

export const IDENTIFIER_FIELD = "dni";

export function dedupeKey(values: { nombre: string; dni?: string }): string {
  const dni = values.dni ? normalizeIdentifier(values.dni) : "";
  if (dni) return `dni:${dni}`;
  const name = normalizeName(values.nombre);
  if (!name) throw new Error("Hace falta el nombre para identificar al asistente.");
  return `nombre:${name}`;
}
