/**
 * Relleno de una plantilla y generación del PDF.
 *
 * 1. Se vuelve a sanear el SVG (aunque ya se saneó al subirlo, por si alguien
 *    tocó la base de datos).
 * 2. Los marcadores se sustituyen en el árbol XML, no en el texto: el valor
 *    entra como nodo de texto y el serializador lo escapa, así que un nombre
 *    con `<` o `&` no rompe ni inyecta nada.
 * 3. El rectángulo `id="qr"` se cambia por el QR vectorial de la URL.
 * 4. Los textos con `data-max-width` se encogen si no caben.
 * 5. Se comprueba que las fuentes tienen todos los caracteres.
 * 6. svg-to-pdfkit dibuja el SVG en un PDF A4 vectorial, sin navegador.
 */
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import { TemplateError } from "./errors";
import { QR_ELEMENT_ID, replaceMarkers, resolveFieldValues, textNodesInText, type FieldConfig } from "./fields";
import { FontSet, parseFontFamilies, type ResolvedFont, type TemplateFontFile } from "./fonts";
import { QR_MARGIN_MODULES, qrPath } from "./qr";
import { DATA_IMAGE, descendants, ELEMENT_NODE, sanitizeSvg, SVG_NS, type Orientation } from "./sanitize";

export interface FillInput {
  /** SVG de la versión de la plantilla (ya saneado al subirlo). */
  svg: string;
  fields: readonly FieldConfig[];
  values: Readonly<Record<string, unknown>>;
  /** Código del certificado, para `{{codigo}}`. */
  code: string;
  /** URL pública del certificado, para `{{url}}` y el QR. */
  url: string;
  fonts: readonly TemplateFontFile[];
}

export interface FilledTemplate {
  svg: string;
  orientation: Orientation;
  warnings: string[];
}

export interface RenderPdfInput extends FillInput {
  title: string;
  author: string;
  /** Fecha que se graba en el PDF. Con la misma fecha y datos, el PDF sale idéntico byte a byte. */
  date: Date;
  attachments?: { name: string; content: Buffer; type: string; description?: string }[];
}

export function fillTemplate(input: FillInput): FilledTemplate {
  return fill(input, new FontSet(input.fonts));
}

function fill(input: FillInput, fonts: FontSet): FilledTemplate {
  const { document, orientation } = sanitizeSvg(input.svg);
  const values = resolveFieldValues(input.fields, input.values, { codigo: input.code, url: input.url });
  const warnings = new Set<string>();

  for (const node of textNodesInText(document)) {
    const text = node.nodeValue ?? "";
    const replaced = replaceMarkers(text, values);
    if (node.nodeType !== 3 || replaced !== text) {
      node.parentNode!.replaceChild(document.createTextNode(replaced), node);
    }
  }

  insertQr(document, input.url);
  const textElements = descendants(document.documentElement!).filter((el) => isSvg(el, "text"));
  for (const text of textElements) fitText(text, fonts, warnings);
  checkCharacters(document, fonts, warnings);

  const root = document.documentElement!;
  root.setAttribute("width", orientation === "landscape" ? "297mm" : "210mm");
  root.setAttribute("height", orientation === "landscape" ? "210mm" : "297mm");

  return { svg: new XMLSerializer().serializeToString(document), orientation, warnings: [...warnings] };
}

export async function renderPdf(input: RenderPdfInput): Promise<{ pdf: Buffer; warnings: string[] }> {
  const fonts = new FontSet(input.fonts);
  const filled = fill(input, fonts);
  const warnings = new Set(filled.warnings);

  const doc = new PDFDocument({
    size: "A4",
    layout: filled.orientation,
    margin: 0,
    pdfVersion: "1.7",
    lang: "es-ES",
    displayTitle: true,
    info: { Title: input.title, Author: input.author, CreationDate: input.date, ModDate: input.date },
  });
  fonts.register(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  SVGtoPDF(doc, filled.svg, 0, 0, {
    width: doc.page.width,
    height: doc.page.height,
    preserveAspectRatio: "xMidYMid meet",
    fontCallback: fonts.fontCallback,
    // Solo imágenes incrustadas: un href a un fichero haría que PDFKit lo leyera del disco.
    imageCallback: (link) => {
      const compact = link.replace(/\s+/g, "");
      return DATA_IMAGE.test(compact) ? Buffer.from(compact.slice(compact.indexOf(",") + 1), "base64") : Buffer.alloc(0);
    },
    documentCallback: () => [],
    warningCallback: (message) => warnings.add(message),
  });

  for (const attachment of input.attachments ?? []) {
    doc.file(attachment.content, {
      name: attachment.name,
      type: attachment.type,
      description: attachment.description,
      creationDate: input.date,
      modifiedDate: input.date,
    });
  }
  doc.end();
  await finished;
  return { pdf: Buffer.concat(chunks), warnings: [...warnings] };
}

function isSvg(element: Element, name: string): boolean {
  return element.namespaceURI === SVG_NS && element.localName === name;
}

function insertQr(document: Document, url: string): void {
  const all = descendants(document.documentElement!);
  const target = all.find((el) => el.getAttribute("id") === QR_ELEMENT_ID);
  if (!target) throw new TemplateError('La plantilla no tiene el sitio del QR: añade un <rect id="qr" …> del tamaño que quieras el QR.');
  if (!isSvg(target, "rect")) throw new TemplateError('El elemento con id="qr" tiene que ser un <rect>.');
  const [x, y, width, height] = ["x", "y", "width", "height"].map((a) => Number(target.getAttribute(a) ?? (a === "x" || a === "y" ? 0 : NaN)));
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width! <= 0 || height! <= 0) {
    throw new TemplateError('El <rect id="qr"> necesita x, y, width y height numéricos, sin unidades.');
  }
  const side = Math.min(width!, height!);
  const left = x! + (width! - side) / 2;
  const top = y! + (height! - side) / 2;
  const { size, d } = qrPath(url);
  const moduleSize = side / (size + 2 * QR_MARGIN_MODULES);

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("id", QR_ELEMENT_ID);
  const transform = target.getAttribute("transform");
  if (transform) group.setAttribute("transform", transform);
  const background = document.createElementNS(SVG_NS, "rect");
  for (const [k, v] of Object.entries({ x: left, y: top, width: side, height: side })) background.setAttribute(k, String(round(v)));
  background.setAttribute("fill", "#ffffff");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "transform",
    `translate(${round(left + QR_MARGIN_MODULES * moduleSize)} ${round(top + QR_MARGIN_MODULES * moduleSize)}) scale(${round(moduleSize)})`,
  );
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000000");
  path.setAttribute("shape-rendering", "crispEdges");
  group.appendChild(background);
  group.appendChild(path);
  target.parentNode!.replaceChild(group, target);
}

function fitText(text: Element, fonts: FontSet, warnings: Set<string>): void {
  const maxAttr = text.getAttribute("data-max-width");
  if (maxAttr === null) return;
  const max = Number(maxAttr);
  if (!Number.isFinite(max) || max <= 0) {
    warnings.add(`data-max-width="${maxAttr}" no es un número: ese texto no se ajusta.`);
    return;
  }
  const content = (text.textContent ?? "").replace(/\s+/g, " ").trim();
  const size = fontSize(text);
  if (!content || size === undefined) {
    if (size === undefined) warnings.add("Un texto con data-max-width tiene un font-size que no se entiende: usa un número sin unidades.");
    return;
  }
  const width = fonts.measure(content, fontFor(text, fonts), size);
  if (width <= max) return;
  const factor = max / width;
  for (const el of [text, ...descendants(text)]) {
    const own = ownStyle(el, "font-size");
    if (el !== text && own === undefined) continue;
    const current = fontSize(el);
    if (current === undefined) continue;
    removeStyleProperty(el, "font-size");
    el.setAttribute("font-size", String(round(current * factor)));
  }
}

function checkCharacters(document: Document, fonts: FontSet, warnings: Set<string>): void {
  const problems: string[] = [];
  for (const node of textNodesInText(document)) {
    const text = node.nodeValue ?? "";
    if (!text.trim()) continue;
    const parent = node.parentNode as Element;
    const font = fontFor(parent, fonts);
    const wanted = parseFontFamilies(computed(parent, "font-family") ?? "sans-serif")[0];
    if (font.standard && wanted && font.family.toLowerCase() !== wanted.toLowerCase()) {
      warnings.add(`La fuente «${wanted}» no está subida con la plantilla: se usa ${font.name}.`);
    }
    const missing = fonts.missingCharacters(text, font);
    if (missing.length) {
      problems.push(`la fuente ${font.standard ? font.name : font.family} no tiene ${missing.map((c) => `«${c}»`).join(" ")} (en «${text.trim().slice(0, 40)}»)`);
    }
  }
  if (problems.length) {
    throw new TemplateError(`Faltan caracteres en las fuentes: ${problems.join("; ")}. Sube una fuente que los tenga.`);
  }
}

function fontFor(element: Element, fonts: FontSet): ResolvedFont {
  const family = computed(element, "font-family") ?? "sans-serif";
  const weight = (computed(element, "font-weight") ?? "normal").trim().toLowerCase();
  const style = (computed(element, "font-style") ?? "normal").trim().toLowerCase();
  const bold = ["bold", "bolder", "600", "700", "800", "900"].includes(weight);
  return fonts.resolve(family, bold, style === "italic" || style === "oblique");
}

/** Valor de una propiedad en el propio elemento: primero `style`, luego el atributo. */
function ownStyle(element: Element, property: string): string | undefined {
  const style = element.getAttribute("style");
  if (style) {
    for (const declaration of style.split(";")) {
      const [name, ...rest] = declaration.split(":");
      if (name?.trim().toLowerCase() === property && rest.length) return rest.join(":").trim();
    }
  }
  return element.getAttribute(property) ?? undefined;
}

function computed(element: Element, property: string): string | undefined {
  for (let el: Element | null = element; el && el.nodeType === ELEMENT_NODE; el = el.parentNode as Element | null) {
    const value = ownStyle(el, property);
    if (value !== undefined && value !== "inherit") return value;
  }
  return undefined;
}

const FONT_SIZE_KEYWORDS: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 };

function fontSize(element: Element): number | undefined {
  const parent = element.parentNode;
  const inherited = parent && parent.nodeType === ELEMENT_NODE ? fontSize(parent as Element) : 16;
  const own = ownStyle(element, "font-size")?.trim().toLowerCase();
  if (own === undefined || own === "inherit") return inherited;
  if (own in FONT_SIZE_KEYWORDS) return FONT_SIZE_KEYWORDS[own];
  const match = /^(\d*\.?\d+)(px|em|%)?$/.exec(own);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (match[2] === "em") return inherited === undefined ? undefined : n * inherited;
  if (match[2] === "%") return inherited === undefined ? undefined : (n / 100) * inherited;
  return n;
}

function removeStyleProperty(element: Element, property: string): void {
  const style = element.getAttribute("style");
  if (!style) return;
  const kept = style.split(";").filter((d) => d.trim() && d.split(":")[0]?.trim().toLowerCase() !== property);
  if (kept.length) element.setAttribute("style", kept.join(";"));
  else element.removeAttribute("style");
}

const round = (n: number) => Math.round(n * 1000) / 1000;
