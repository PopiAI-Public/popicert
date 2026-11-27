import { describe, expect, it } from "vitest";
import type { FieldConfig } from "@/lib/templates/fields";
import { csvAttendees, mapColumns, MAX_CSV_ROWS, parseCsv, toCsv, toTsv } from "./csv";
import { dedupeKey, normalizeIdentifier, normalizeName } from "./dedupe";

const fields: FieldConfig[] = [
  { key: "nombre", label: "Nombre y apellidos", scope: "attendee", required: true, public: true },
  { key: "dni", label: "DNI", scope: "attendee", required: false, public: false },
];

describe("parseCsv", () => {
  it("detecta el separador de la cabecera: coma, punto y coma o tabulador", () => {
    expect(parseCsv("a,b\n1,2").rows[0]!.cells).toEqual(["1", "2"]);
    expect(parseCsv("a;b\n1,5;2").rows[0]!.cells).toEqual(["1,5", "2"]);
    expect(parseCsv("a\tb\n1\t2").rows[0]!.cells).toEqual(["1", "2"]);
  });

  it("entiende comillas, comillas dobles escapadas y saltos de línea dentro de un campo", () => {
    const parsed = parseCsv('nombre;nota\r\n"Pérez; Ana";"dijo ""hola"""\r\n"Varias\nlíneas";x\r\nLuis;y\r\n');
    expect(parsed.rows.map((r) => r.cells)).toEqual([
      ["Pérez; Ana", 'dijo "hola"'],
      ["Varias\nlíneas", "x"],
      ["Luis", "y"],
    ]);
    // El número de línea es el del fichero, aunque un campo ocupe varias.
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 3, 5]);
  });

  it("quita el BOM y se salta las filas vacías", () => {
    // Excel deja filas con solo separadores al final de la hoja.
    const parsed = parseCsv("﻿nombre;dni\n\n;\nAna;\n;;\n\n");
    expect(parsed.header).toEqual(["nombre", "dni"]);
    expect(parsed.rows.map((r) => r.cells[0])).toEqual(["Ana"]);
  });

  it("falla con unas comillas sin cerrar o un CSV vacío", () => {
    expect(() => parseCsv('nombre\n"Ana')).toThrow(/comillas sin cerrar.*línea 2/);
    expect(() => parseCsv("")).toThrow(/vacío/);
    expect(() => parseCsv("\n\n")).toThrow(/vacío/);
  });
});

describe("mapColumns", () => {
  it("asocia por clave o por nombre, sin mayúsculas ni tildes, y reconoce el email", () => {
    const mapping = mapColumns(["NOMBRE Y APELLIDOS", "Correo electrónico", "dni", "Teléfono"], fields);
    expect([...mapping.fields]).toEqual([
      ["nombre", 0],
      ["dni", 2],
    ]);
    expect(mapping.email).toBe(1);
    expect(mapping.ignored).toEqual(["Teléfono"]);
  });

  it("falla si falta una columna obligatoria o si se repite", () => {
    expect(() => mapColumns(["dni"], fields)).toThrow(/Faltan columnas.*«nombre»/);
    expect(() => mapColumns(["nombre", "Nombre y apellidos"], fields)).toThrow(/repetida/);
    expect(() => mapColumns(["nombre", "email", "correo"], fields)).toThrow(/email está repetida/);
  });

  it("limita el número de filas", () => {
    const csv = "nombre\n" + Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `A${i}`).join("\n");
    const parsed = parseCsv(csv);
    expect(() => csvAttendees(parsed, mapColumns(parsed.header, fields))).toThrow(new RegExp(`como mucho .*${MAX_CSV_ROWS}`));
  });

  it("las celdas que faltan al final de una fila quedan vacías", () => {
    const parsed = parseCsv("nombre;dni;email\nAna\n");
    expect(csvAttendees(parsed, mapColumns(parsed.header, fields))).toEqual([{ line: 2, values: { nombre: "Ana", dni: "" } }]);
  });
});

describe("exportación", () => {
  it("CSV con BOM y punto y coma, escapando lo necesario y sin fórmulas", () => {
    const csv = toCsv([
      ["Nombre", "Enlace"],
      ["Pérez; Ana", 'con "comillas"'],
      ["=1+1", "+34 600"],
      ["@SUM(A1)", "-2"],
    ]);
    expect(csv).toBe('﻿Nombre;Enlace\r\n"Pérez; Ana";"con ""comillas"""\r\n\'=1+1;\'+34 600\r\n\'@SUM(A1);\'-2\r\n');
  });

  it("texto con tabuladores para pegar, sin tabuladores ni saltos dentro de las celdas", () => {
    expect(toTsv([["a\tb", "c\nd"], ["=x", "y"]])).toBe("a b\tc d\n'=x\ty");
  });

  it("lo exportado se vuelve a leer igual", () => {
    const rows = [["nombre", "dni"], ["Pérez; Ana \"la\"", "1"], ["Luis\nGarcía", "2"]];
    expect(parseCsv(toCsv(rows)).rows.map((r) => r.cells)).toEqual(rows.slice(1));
  });
});

describe("clave de duplicado", () => {
  it("el mismo nombre escrito de otra forma es la misma persona", () => {
    expect(normalizeName("  José   PÉREZ-García ")).toBe("jose perez garcia");
    expect(dedupeKey({ nombre: "José Pérez" })).toBe(dedupeKey({ nombre: "JOSE PEREZ" }));
    expect(dedupeKey({ nombre: "Ana López" })).not.toBe(dedupeKey({ nombre: "Ana Lopes" }));
  });

  it("con DNI manda el DNI, normalizado", () => {
    expect(normalizeIdentifier("12.345.678-z")).toBe("12345678Z");
    expect(dedupeKey({ nombre: "Ana", dni: "12345678z" })).toBe(dedupeKey({ nombre: "Otra", dni: "12 345 678-Z" }));
    expect(dedupeKey({ nombre: "Ana", dni: "  " })).toBe("nombre:ana");
  });

  it("sin nombre no hay clave", () => {
    expect(() => dedupeKey({ nombre: " ¡! " })).toThrow();
  });
});
