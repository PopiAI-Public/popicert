/**
 * Piezas comunes de las rutas del admin de plantillas: leer la subida,
 * responder errores y generar las vistas previas.
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { getConfig } from "@/lib/config";
import { TemplateError } from "./errors";
import type { FontUpload } from "./prepare";
import { fillTemplate, renderPdf } from "./render";
import { TemplateNotFoundError, type TemplateVersionRecord } from "./repository";
import type { TemplateFontFile } from "./fonts";
import { MAX_SVG_BYTES, SVG_NS } from "./sanitize";
import { sampleReserved, sampleValues } from "./samples";

/**
 * Tamaño máximo de una subida (SVG y fuentes juntos). Coincide con lo que el
 * proxy de Next.js guarda en memoria de cada petición (`proxyClientMaxBodySize`,
 * 10 MB por defecto): por encima, el cuerpo llegaría cortado.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/** Errores conocidos a respuestas JSON con un mensaje para el admin; el resto, para arriba. */
export function templateErrorResponse(error: unknown): Response {
  if (error instanceof TemplateError) return json({ error: error.message }, 422);
  if (error instanceof TemplateNotFoundError) return json({ error: error.message }, 404);
  throw error;
}

export interface TemplateUpload {
  name: string;
  svg: string;
  fonts: FontUpload[];
}

/** Lee un `multipart/form-data` con `name`, `svg` y cero o más `fonts`. */
export async function readTemplateUpload(request: Request, options: { requireName: boolean }): Promise<TemplateUpload> {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) throw new TemplateError("Falta el tamaño de la subida (Content-Length).");
  if (length > MAX_UPLOAD_BYTES) throw new TemplateError(`La subida ocupa más de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB entre el SVG y las fuentes.`);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new TemplateError("La subida no es un formulario válido.");
  }
  const name = String(form.get("name") ?? "");
  if (options.requireName && !name.trim()) throw new TemplateError("La plantilla necesita un nombre.");

  const svgFile = form.get("svg");
  if (!(svgFile instanceof File) || svgFile.size === 0) throw new TemplateError("Falta el fichero SVG.");
  if (svgFile.size > MAX_SVG_BYTES) throw new TemplateError(`El SVG ocupa más de ${MAX_SVG_BYTES / 1024 / 1024} MB.`);
  const svg = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(await svgFile.arrayBuffer());

  const fonts: FontUpload[] = [];
  for (const entry of form.getAll("fonts")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    fonts.push({ fileName: safeFileName(entry.name), data: Buffer.from(await entry.arrayBuffer()) });
  }
  return { name, svg, fonts };
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 100).trim();
  return clean || "fuente";
}

function previewInput(version: TemplateVersionRecord) {
  const reserved = sampleReserved(getConfig().PUBLIC_URL);
  return {
    svg: version.svg,
    fields: version.fields,
    values: sampleValues(version.fields),
    code: reserved.codigo,
    url: reserved.url,
    fonts: version.fonts,
  };
}

/**
 * Vista previa en SVG. Se sirve con una CSP que no deja ejecutar ni cargar
 * nada, por si el saneado se dejara algo y alguien abriera la URL directamente.
 */
export function previewSvgResponse(version: TemplateVersionRecord): Response {
  const { svg } = fillTemplate(previewInput(version));
  return new Response(withEmbeddedFonts(svg, version.fonts), {
    headers: {
      ...NO_STORE,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function previewPdfResponse(version: TemplateVersionRecord): Promise<Response> {
  const { pdf } = await renderPdf({
    ...previewInput(version),
    title: `${version.templateName} (v${version.version}) — vista previa`,
    author: getConfig().ISSUER_NAME,
    date: version.createdAt,
  });
  const fileName = `vista-previa-v${version.version}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Para que la vista previa en pantalla use las mismas fuentes que el PDF, se
 * incrustan como `@font-face` con `data:`. Solo en la vista previa: el SVG
 * guardado no lleva fuentes dentro.
 */
function withEmbeddedFonts(svg: string, fonts: readonly TemplateFontFile[]): string {
  if (fonts.length === 0) return svg;
  const css = fonts
    .map((font) => {
      const family = font.family.replace(/[^\p{L}\p{N} _-]/gu, "");
      const magic = font.data.subarray(0, 4).toString("latin1");
      const mime = magic === "wOFF" ? "font/woff" : magic === "OTTO" ? "font/otf" : "font/ttf";
      return `@font-face{font-family:"${family}";font-weight:${font.bold ? 700 : 400};font-style:${font.italic ? "italic" : "normal"};src:url(data:${mime};base64,${font.data.toString("base64")})}`;
    })
    .join("");
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const style = document.createElementNS(SVG_NS, "style");
  style.appendChild(document.createTextNode(css));
  const root = document.documentElement!;
  root.insertBefore(style, root.firstChild);
  return new XMLSerializer().serializeToString(document);
}
