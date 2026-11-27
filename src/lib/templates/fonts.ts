/**
 * Fuentes de las plantillas.
 *
 * Al generar el PDF no se descarga nada: o la fuente se sube junto a la
 * plantilla (TTF, OTF o WOFF), o se usa una de las estándar del PDF
 * (Helvetica, Times, Courier). Las estándar solo tienen los caracteres
 * de Windows-1252, que cubren el español; para cualquier otro carácter
 * hace falta subir una fuente que lo tenga.
 */
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import * as fontkit from "fontkit";
import { TemplateError } from "./errors";

export const MAX_FONT_BYTES = 5 * 1024 * 1024;
export const MAX_FONTS = 12;

export interface TemplateFontFile {
  family: string;
  bold: boolean;
  italic: boolean;
  data: Buffer;
}

export interface UploadedFont extends TemplateFontFile {
  fileName: string;
  sha256: string;
}

/** Fuente elegida para un texto: una subida o una estándar del PDF. */
export interface ResolvedFont {
  /** Nombre con el que está registrada en el documento PDF. */
  name: string;
  family: string;
  standard: boolean;
  fauxBold: boolean;
  fauxItalic: boolean;
  font?: fontkit.Font;
}

const STANDARD = {
  sans: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  serif: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  mono: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
} as const;

const STANDARD_FAMILIES: Record<string, keyof typeof STANDARD> = {
  "sans-serif": "sans",
  helvetica: "sans",
  arial: "sans",
  serif: "serif",
  times: "serif",
  "times new roman": "serif",
  "times-roman": "serif",
  monospace: "mono",
  courier: "mono",
  "courier new": "mono",
};

/** Caracteres de Windows-1252 que tienen las fuentes estándar del PDF. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function inWinAnsi(char: string): boolean {
  const code = char.codePointAt(0)!;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(char);
}

const variantIndex = (bold: boolean, italic: boolean) => (bold ? 1 : 0) + (italic ? 2 : 0);
const fontName = (f: { family: string; bold: boolean; italic: boolean }) =>
  `popicert:${f.family}:${f.bold ? "b" : ""}${f.italic ? "i" : ""}`;

/** Lee una fuente subida y comprueba que se puede incrustar en un PDF. */
export async function inspectFont(fileName: string, data: Buffer): Promise<UploadedFont> {
  if (data.byteLength > MAX_FONT_BYTES) {
    throw new TemplateError(`La fuente ${fileName} ocupa más de ${MAX_FONT_BYTES / 1024 / 1024} MB.`);
  }
  if (data.subarray(0, 4).toString("latin1") === "wOF2") {
    throw new TemplateError(`${fileName} es WOFF2, que no se puede incrustar en el PDF. Sube la versión TTF, OTF o WOFF.`);
  }
  let font: fontkit.Font;
  try {
    const parsed = fontkit.create(data);
    if ("fonts" in parsed) throw new TemplateError(`${fileName} es una colección de fuentes (TTC). Sube cada estilo por separado.`);
    font = parsed;
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(`${fileName} no es una fuente TTF, OTF o WOFF válida.`);
  }
  const family = (font.getName("preferredFamily") || font.familyName || "").trim();
  if (!family) throw new TemplateError(`${fileName} no tiene nombre de familia.`);
  const subfamily = (font.getName("preferredSubfamily") || font.subfamilyName || "").toLowerCase();
  const weight = font["OS/2"]?.usWeightClass ?? (/bold|black|heavy/.test(subfamily) ? 700 : 400);
  const result: UploadedFont = {
    fileName,
    family,
    bold: weight >= 600,
    italic: Boolean(font["OS/2"]?.fsSelection?.italic) || font.italicAngle !== 0 || /italic|oblique/.test(subfamily),
    data,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
  // Prueba de verdad: incrustarla en un PDF. Hay fuentes que fontkit abre pero no sabe recortar.
  try {
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: true });
      doc.on("data", () => {});
      doc.on("end", resolve);
      doc.on("error", reject);
      doc.registerFont("prueba", data);
      doc.font("prueba").text("Aá Éé Íí Óó Úú Ññ Üü 0123");
      doc.end();
    });
  } catch {
    throw new TemplateError(`${fileName} no se puede incrustar en el PDF. Prueba con la versión TTF de la fuente.`);
  }
  return result;
}

export function checkFontSet(fonts: readonly { family: string; bold: boolean; italic: boolean; fileName?: string }[]): void {
  if (fonts.length > MAX_FONTS) throw new TemplateError(`Como mucho se pueden subir ${MAX_FONTS} fuentes por plantilla.`);
  const seen = new Set<string>();
  for (const font of fonts) {
    const key = fontName({ ...font, family: font.family.toLowerCase() });
    if (seen.has(key)) {
      throw new TemplateError(
        `Hay dos fuentes con la misma familia y estilo (${font.family}${font.bold ? " negrita" : ""}${font.italic ? " cursiva" : ""}).`,
      );
    }
    seen.add(key);
  }
}

/** Separa una lista CSS de familias: `'EB Garamond', Georgia, serif`. */
export function parseFontFamilies(value: string): string[] {
  return value
    .split(",")
    .map((f) => f.trim().replace(/^(['"])(.*)\1$/, "$2").trim())
    .filter(Boolean);
}

/** Las fuentes de una plantilla y cómo se eligen para cada texto. */
export class FontSet {
  private readonly byFamily = new Map<string, (TemplateFontFile & { font: fontkit.Font })[]>();
  private measureDoc?: PDFKit.PDFDocument;

  constructor(readonly fonts: readonly TemplateFontFile[]) {
    checkFontSet(fonts);
    for (const file of fonts) {
      const parsed = fontkit.create(file.data);
      if ("fonts" in parsed) throw new TemplateError("Colección de fuentes no admitida.");
      const key = file.family.toLowerCase();
      this.byFamily.set(key, [...(this.byFamily.get(key) ?? []), { ...file, font: parsed }]);
    }
  }

  register(doc: PDFKit.PDFDocument): void {
    for (const file of this.fonts) doc.registerFont(fontName(file), file.data);
  }

  /** Elige fuente como un navegador: la primera familia de la lista que esté disponible. */
  resolve(familyList: string, bold: boolean, italic: boolean): ResolvedFont {
    for (const family of parseFontFamilies(familyList)) {
      const uploaded = this.byFamily.get(family.toLowerCase());
      if (uploaded) {
        const exact = uploaded.find((f) => f.bold === bold && f.italic === italic);
        const pick =
          exact ??
          uploaded.find((f) => f.italic === italic && !f.bold) ??
          uploaded.find((f) => f.bold === bold && !f.italic) ??
          uploaded.find((f) => !f.bold && !f.italic) ??
          uploaded[0]!;
        return {
          name: fontName(pick),
          family: pick.family,
          standard: false,
          fauxBold: bold && !pick.bold,
          fauxItalic: italic && !pick.italic,
          font: pick.font,
        };
      }
      const standard = STANDARD_FAMILIES[family.toLowerCase()];
      if (standard) return this.standard(standard, bold, italic, family);
    }
    return this.standard("sans", bold, italic, "Helvetica");
  }

  private standard(kind: keyof typeof STANDARD, bold: boolean, italic: boolean, family: string): ResolvedFont {
    return { name: STANDARD[kind][variantIndex(bold, italic)]!, family, standard: true, fauxBold: false, fauxItalic: false };
  }

  /** Ancho de un texto, en las mismas unidades que `size`. */
  measure(text: string, font: ResolvedFont, size: number): number {
    if (!this.measureDoc) {
      this.measureDoc = new PDFDocument({ autoFirstPage: false });
      this.register(this.measureDoc);
    }
    return this.measureDoc.font(font.name).fontSize(size).widthOfString(text);
  }

  /** Caracteres del texto que la fuente no tiene. */
  missingCharacters(text: string, font: ResolvedFont): string[] {
    const missing = new Set<string>();
    for (const char of text) {
      if (/\s/.test(char)) continue;
      const ok = font.standard ? inWinAnsi(char) : font.font!.hasGlyphForCodePoint(char.codePointAt(0)!);
      if (!ok) missing.add(char);
    }
    return [...missing];
  }

  /** `fontCallback` para svg-to-pdfkit: nunca devuelve un nombre sin registrar. */
  readonly fontCallback = (family: string, bold: boolean, italic: boolean, options: { fauxBold?: boolean; fauxItalic?: boolean }) => {
    const resolved = this.resolve(family, bold, italic);
    if (resolved.fauxBold) options.fauxBold = true;
    if (resolved.fauxItalic) options.fauxItalic = true;
    return resolved.name;
  };
}
