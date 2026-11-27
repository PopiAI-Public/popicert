import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { TemplateError } from "./errors";
import { detectMarkers, mergeFieldConfig, type FieldConfig } from "./fields";
import { checkFontSet, inspectFont, type UploadedFont } from "./fonts";
import { fillTemplate, renderPdf, type FillInput } from "./render";
import { sanitizeSvg } from "./sanitize";
import { decodeQrFromPdf, EXAMPLE_VALUES, exampleFonts, exampleSvg, hasPoppler, pdfInfo, pdfText } from "./testing";

const URL = "https://certificados.popiai.es/c/ABCD234567";
const DATE = new Date("2026-11-27T10:00:00Z");
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let fonts: UploadedFont[];
let fields: FieldConfig[];
let svg: string;

beforeAll(async () => {
  fonts = await exampleFonts();
  const sanitized = sanitizeSvg(exampleSvg());
  svg = sanitized.svg;
  fields = mergeFieldConfig(detectMarkers(sanitized.document).fields);
});

function input(overrides: Partial<FillInput> = {}): FillInput {
  return { svg, fields, values: EXAMPLE_VALUES, code: "ABCD234567", url: URL, fonts, ...overrides };
}

function nameFontSize(filled: string): number {
  const doc = new DOMParser().parseFromString(filled, "image/svg+xml");
  const texts = Array.from({ length: doc.getElementsByTagName("text").length }, (_, i) => doc.getElementsByTagName("text").item(i)!);
  const name = texts.find((t) => t.getAttribute("data-max-width") === "230" && t.getAttribute("font-weight") === "bold")!;
  return Number(name.getAttribute("font-size"));
}

function minimal(body: string, values: Record<string, string> = {}): FillInput {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210"><rect id="qr" x="10" y="10" width="30" height="30"/>${body}</svg>`;
  const doc = sanitizeSvg(source);
  return { svg: doc.svg, fields: mergeFieldConfig(detectMarkers(doc.document).fields), values, code: "C", url: URL, fonts: [] };
}

describe("fuentes subidas", () => {
  it("lee familia, negrita y cursiva de cada fichero", () => {
    expect(fonts.map((f) => [f.family, f.bold, f.italic])).toEqual([
      ["EB Garamond", false, false],
      ["EB Garamond", false, true],
      ["EB Garamond", true, false],
      ["EB Garamond", true, true],
    ]);
    expect(fonts[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rechaza WOFF2, ficheros que no son fuentes y fuentes repetidas", async () => {
    await expect(inspectFont("x.woff2", Buffer.from("wOF2xxxxxxxxxxxxxxxx"))).rejects.toThrow(/WOFF2/);
    await expect(inspectFont("x.ttf", Buffer.from("esto no es una fuente"))).rejects.toThrow(TemplateError);
    expect(() => checkFontSet([fonts[0]!, { ...fonts[0]!, fileName: "otra.woff" }])).toThrow(/misma familia/);
  });
});

describe("relleno de la plantilla", () => {
  it("sustituye los campos y los reservados, y quita el rectángulo del QR", () => {
    const { svg: filled, warnings } = fillTemplate(input());
    expect(warnings).toEqual([]);
    expect(filled).toContain("María José Fernández-Castañeda Núñez");
    expect(filled).toContain("con una duración de 8 horas, en Valencia, el 27 de noviembre de 2026.");
    expect(filled).toContain("Código ABCD234567");
    expect(filled).toContain(URL);
    expect(filled).not.toMatch(/\{\{|\}\}/);
    expect(filled).not.toContain("#e0e0e0");
    expect(filled).toMatch(/<g id="qr"><rect[^>]+fill="#ffffff"\/><path transform="translate\(/);
  });

  it("los valores no pueden inyectar marcado", () => {
    const evil = '</text><script>alert(1)</script><text>"&amp;\'';
    const { svg: filled } = fillTemplate(input({ values: { ...EXAMPLE_VALUES, nombre: evil } }));
    expect(filled).not.toContain("<script>");
    expect(filled).toContain("&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;text&gt;\"&amp;amp;'");
    // Sigue siendo un SVG válido y sin elementos nuevos.
    const before = (svg.match(/<text/g) ?? []).length;
    expect((filled.match(/<text/g) ?? []).length).toBe(before);
    expect(sanitizeSvg(filled).removed).toEqual([]);
  });

  it("un valor con forma de marcador no se vuelve a sustituir", () => {
    const { svg: filled } = fillTemplate(input({ values: { ...EXAMPLE_VALUES, nombre: "{{codigo}}" } }));
    expect(filled).toContain(">{{codigo}}<");
  });

  it("encoge los nombres que no caben y deja como están los que caben", () => {
    const short = nameFontSize(fillTemplate(input({ values: { ...EXAMPLE_VALUES, nombre: "Ana Peña" } })).svg);
    expect(short).toBe(14);
    const longName = "María de los Ángeles Fernández-Castañeda de la Peña y Núñez de Arenas Güell";
    const long = nameFontSize(fillTemplate(input({ values: { ...EXAMPLE_VALUES, nombre: longName } })).svg);
    expect(long).toBeLessThan(14);
    expect(long).toBeGreaterThan(5);
  });

  it("falla si faltan datos obligatorios", () => {
    expect(() => fillTemplate(input({ values: { ...EXAMPLE_VALUES, nombre: "" } }))).toThrow(/falta «Nombre»/);
  });

  it("falla si la fuente no tiene algún carácter, en vez de imprimir cuadraditos", () => {
    // EB Garamond (subconjunto latino) no tiene la Ł polaca.
    expect(() => fillTemplate(input({ values: { ...EXAMPLE_VALUES, nombre: "Łukasz" } }))).toThrow(/«Ł»/);
    // Las fuentes estándar del PDF solo tienen Windows-1252.
    expect(() => fillTemplate(minimal('<text x="1" y="1">{{nombre}}</text>', { nombre: "Ζεύς" }))).toThrow(/Helvetica no tiene/);
    // Pero sí todo el español.
    expect(() => fillTemplate(minimal('<text x="1" y="1">{{nombre}}</text>', { nombre: "¿Peña Güell? ¡Sí! Ñandú — 1 €" }))).not.toThrow();
  });

  it("avisa si la plantilla pide una fuente que no se ha subido", () => {
    const { warnings } = fillTemplate(minimal('<text x="1" y="1" font-family="Playfair Display, serif">{{nombre}}</text>', { nombre: "Ana" }));
    expect(warnings.join()).toMatch(/Playfair Display.*Times-Roman/);
  });

  it("exige el rectángulo del QR", () => {
    const noQr = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210"><text x="1" y="1">Hola</text></svg>');
    expect(() => fillTemplate({ ...input(), svg: noQr.svg, fields: [] })).toThrow(/id="qr"/);
    const circle = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210"><circle id="qr" r="3"/></svg>');
    expect(() => fillTemplate({ ...input(), svg: circle.svg, fields: [] })).toThrow(/<rect>/);
    const units = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210"><rect id="qr" width="3cm" height="3cm"/></svg>');
    expect(() => fillTemplate({ ...input(), svg: units.svg, fields: [] })).toThrow(/sin unidades/);
  });

  it("vuelve a sanear el SVG guardado, por si alguien lo tocó en la base de datos", () => {
    const tampered = svg.replace("</svg>", '<script>alert(1)</script><image href="/etc/passwd" width="1" height="1"/></svg>');
    const { svg: filled } = fillTemplate(input({ svg: tampered }));
    expect(filled).not.toMatch(/script|passwd/);
  });
});

describe.skipIf(!hasPoppler() && !process.env.CI)("PDF", () => {
  it("en CI tiene que estar Poppler", () => {
    expect(hasPoppler()).toBe(true);
  });

  it("genera un A4 horizontal con el texto correcto y las fuentes incrustadas", async () => {
    const { pdf, warnings } = await renderPdf({ ...input(), title: "Diploma de prueba", author: "PopiAI", date: DATE });
    expect(warnings).toEqual([]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(pdf).replace(/\s+/g, " ");
    for (const expected of [
      "María José Fernández-Castañeda Núñez",
      "Introducción a la IA generativa",
      "Certificado de aprovechamiento",
      "Código ABCD234567",
      URL,
    ]) {
      expect(text).toContain(expected);
    }
    const info = pdfInfo(pdf);
    expect(info).toMatch(/Page size:\s+841\.89 x 595\.28 pts \(A4\)/);
    expect(info).toMatch(/Title:\s+Diploma de prueba/);
    // Sin la fuente de la plantilla no habría ni una fuente incrustada.
    expect(pdf.toString("latin1")).toMatch(/EBGaramond-Regular/);
  });

  it("el QR impreso se lee y lleva a la página del certificado", async () => {
    const { pdf } = await renderPdf({ ...input(), title: "t", author: "a", date: DATE });
    expect(decodeQrFromPdf(pdf, 150)).toBe(URL);
    // También a la resolución de una impresora mediocre.
    expect(decodeQrFromPdf(pdf, 72)).toBe(URL);
  });

  it("los nombres largos con tildes caben y se leen enteros", async () => {
    const nombre = "María de los Ángeles Fernández-Castañeda de la Peña y Núñez de Arenas Güell";
    const { pdf } = await renderPdf({ ...input({ values: { ...EXAMPLE_VALUES, nombre } }), title: "t", author: "a", date: DATE });
    expect(pdfText(pdf).replace(/\s+/g, " ")).toContain(nombre);
  });

  it("con los mismos datos y fecha, el PDF sale idéntico byte a byte", async () => {
    const a = await renderPdf({ ...input(), title: "t", author: "a", date: DATE });
    const b = await renderPdf({ ...input(), title: "t", author: "a", date: DATE });
    expect(a.pdf.equals(b.pdf)).toBe(true);
  });

  it("puede llevar la credencial firmada como fichero adjunto", async () => {
    const credential = Buffer.from(JSON.stringify({ type: ["VerifiableCredential", "OpenBadgeCredential"] }));
    const { pdf } = await renderPdf({
      ...input(),
      title: "t",
      author: "a",
      date: DATE,
      attachments: [{ name: "credencial.json", content: credential, type: "application/json" }],
    });
    const raw = pdf.toString("latin1");
    expect(raw).toContain("/EmbeddedFiles");
    expect(raw).toContain("(credencial.json)");
  });

  it("no lee ficheros del disco aunque el SVG guardado los pida", async () => {
    // Un PNG de verdad en el disco: si PDFKit siguiera la ruta, el PDF llevaría la imagen.
    const dir = mkdtempSync(join(tmpdir(), "popicert-img-"));
    const local = join(dir, "imagen.png");
    writeFileSync(local, Buffer.from(PNG_1PX.split(",")[1]!, "base64"));
    try {
      const tampered = svg.replace("</svg>", `<image href="${local}" width="10" height="10"/></svg>`);
      const { pdf } = await renderPdf({ ...input({ svg: tampered }), title: "t", author: "a", date: DATE });
      const clean = await renderPdf({ ...input(), title: "t", author: "a", date: DATE });
      expect(pdf.equals(clean.pdf)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("las imágenes incrustadas sí salen en el PDF", async () => {
    const withImage = svg.replace("</svg>", `<image href="${PNG_1PX}" x="0" y="0" width="10" height="10"/></svg>`);
    const { pdf } = await renderPdf({ ...input({ svg: withImage }), title: "t", author: "a", date: DATE });
    expect(pdf.toString("latin1")).toMatch(/\/Subtype \/Image/);
  });
});
