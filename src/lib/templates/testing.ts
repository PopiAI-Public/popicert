// Utilidades para los tests de plantillas: la plantilla de ejemplo del repo y
// herramientas para leer el PDF como lo haría una persona (texto y QR).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jsQR from "jsqr";
import { inspectFont, type UploadedFont } from "./fonts";

export const EXAMPLE_DIR = join(import.meta.dirname, "..", "..", "..", "plantillas", "ejemplo");
export const EXAMPLE_FONT_FILES = ["400-normal", "400-italic", "700-normal", "700-italic"].map((v) => `EBGaramond-${v}.woff`);

export function exampleSvg(): string {
  return readFileSync(join(EXAMPLE_DIR, "diploma.svg"), "utf8");
}

export async function exampleFonts(): Promise<UploadedFont[]> {
  return Promise.all(EXAMPLE_FONT_FILES.map((f) => inspectFont(f, readFileSync(join(EXAMPLE_DIR, "fuentes", f)))));
}

export const EXAMPLE_VALUES = {
  nombre: "María José Fernández-Castañeda Núñez",
  formacion: "Introducción a la IA generativa",
  horas: "8",
  lugar: "Valencia",
  fecha: "27 de noviembre de 2026",
  ponente: "Ana Peña",
};

/** ¿Están las herramientas de Poppler (pdftotext, pdftoppm)? En CI se instalan siempre. */
export function hasPoppler(): boolean {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function withPdf<T>(pdf: Buffer, run: (file: string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "popicert-pdf-"));
  try {
    const file = join(dir, "doc.pdf");
    writeFileSync(file, pdf);
    return run(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pdfText(pdf: Buffer): string {
  return withPdf(pdf, (file) => execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }));
}

export function pdfInfo(pdf: Buffer): string {
  return withPdf(pdf, (file) => execFileSync("pdfinfo", [file], { encoding: "utf8" }));
}

/** Rasteriza la página como una impresora y lee el QR como un móvil. */
export function decodeQrFromPdf(pdf: Buffer, dpi = 150): string | null {
  return withPdf(pdf, (file, dir) => {
    execFileSync("pdftoppm", ["-r", String(dpi), "-singlefile", file, join(dir, "page")]);
    const ppm = readFileSync(join(dir, "page.ppm"));
    const { width, height, offset } = parsePpmHeader(ppm);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = offset; i < width * height; i++, j += 3) {
      rgba[i * 4] = ppm[j]!;
      rgba[i * 4 + 1] = ppm[j + 1]!;
      rgba[i * 4 + 2] = ppm[j + 2]!;
      rgba[i * 4 + 3] = 255;
    }
    return jsQR(rgba, width, height)?.data ?? null;
  });
}

function parsePpmHeader(ppm: Buffer) {
  // "P6\n<ancho> <alto>\n255\n" seguido de los píxeles RGB.
  const tokens: string[] = [];
  let i = 0;
  while (tokens.length < 4) {
    while (/\s/.test(String.fromCharCode(ppm[i]!))) i++;
    let token = "";
    while (!/\s/.test(String.fromCharCode(ppm[i]!))) token += String.fromCharCode(ppm[i++]!);
    tokens.push(token);
  }
  if (tokens[0] !== "P6" || tokens[3] !== "255") throw new Error("PPM inesperado");
  return { width: Number(tokens[1]), height: Number(tokens[2]), offset: i + 1 };
}
