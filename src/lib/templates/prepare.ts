/**
 * Preparación de una plantilla subida: saneado, detección de campos, lectura
 * de las fuentes y un PDF de prueba con datos de ejemplo. Si algo impide
 * generar diplomas con ella, falla aquí, al subirla, y no al emitir.
 */
import { createHash } from "node:crypto";
import { TemplateError } from "./errors";
import { detectMarkers, mergeFieldConfig, type FieldConfig, type ReservedField } from "./fields";
import { checkFontSet, inspectFont, MAX_FONTS, type UploadedFont } from "./fonts";
import { renderPdf } from "./render";
import { sanitizeSvg, type Orientation } from "./sanitize";
import { sampleReserved, sampleValues } from "./samples";

export interface FontUpload {
  fileName: string;
  data: Buffer;
}

export interface TemplateReport {
  removed: string[];
  warnings: string[];
}

export interface PreparedTemplate {
  svg: string;
  svgSha256: string;
  orientation: Orientation;
  fields: FieldConfig[];
  reserved: ReservedField[];
  fonts: UploadedFont[];
  report: TemplateReport;
}

export async function prepareTemplate(input: {
  svg: string;
  fonts: readonly FontUpload[];
  publicUrl: string;
  /** Configuración de la versión anterior, para no tener que repetirla. */
  previousFields?: readonly FieldConfig[];
}): Promise<PreparedTemplate> {
  if (input.fonts.length > MAX_FONTS) throw new TemplateError(`Como mucho se pueden subir ${MAX_FONTS} fuentes por plantilla.`);
  const sanitized = sanitizeSvg(input.svg);
  const markers = detectMarkers(sanitized.document);
  const fonts = [];
  for (const upload of input.fonts) fonts.push(await inspectFont(upload.fileName, upload.data));
  checkFontSet(fonts);
  const fields = mergeFieldConfig(markers.fields, input.previousFields);

  const warnings = [...markers.warnings];
  if (markers.fields.length === 0) warnings.push("La plantilla no tiene ningún {{campo}}: todos los diplomas saldrían iguales.");

  // PDF de prueba: descubre ahora el QR que falta, las fuentes sin tildes, etc.
  const reserved = sampleReserved(input.publicUrl);
  const { warnings: renderWarnings } = await renderPdf({
    svg: sanitized.svg,
    fields,
    values: sampleValues(fields),
    code: reserved.codigo,
    url: reserved.url,
    fonts,
    title: "Prueba",
    author: "PopiCert",
    date: new Date(0),
  });
  warnings.push(...renderWarnings);

  return {
    svg: sanitized.svg,
    svgSha256: createHash("sha256").update(sanitized.svg).digest("hex"),
    orientation: sanitized.orientation,
    fields,
    reserved: markers.reserved,
    fonts,
    report: { removed: sanitized.removed, warnings: [...new Set(warnings)] },
  };
}
