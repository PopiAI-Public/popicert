/**
 * Saneado de plantillas SVG.
 *
 * La plantilla es contenido no fiable: la sube alguien del admin, pero puede
 * venir de cualquier herramienta o de internet. El saneado trabaja con una
 * lista de lo permitido y devuelve un SVG que:
 *
 * - no ejecuta nada si se abre en un navegador: sin `<script>`, sin
 *   manejadores `on*`, sin `foreignObject`, sin animaciones que cambien
 *   atributos y sin enlaces `javascript:`;
 * - no carga nada de fuera: los `href` solo apuntan a elementos del propio
 *   documento (`#id`) o a imágenes PNG/JPEG incrustadas (`data:`), y el CSS
 *   no puede usar `@import`, `@font-face` ni `url()` hacia fuera.
 *
 * Lo que no encaja se elimina y se apunta en el informe, para que el admin
 * vea qué se ha quitado. Se rechaza la plantilla entera solo si no es un SVG
 * válido, si trae DOCTYPE o entidades, o si no tiene las medidas de un A4.
 */
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { TemplateError } from "./errors";

export const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** Tamaño máximo del SVG, con las imágenes incrustadas incluidas. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** Elementos que se conservan. Todo lo demás se elimina con su contenido. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "style",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "marker",
]);

/** Elementos que se quitan pero conservando su contenido (un enlace alrededor de un texto). */
const UNWRAP_ELEMENTS = new Set(["a"]);

export const DATA_IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/;
const LOCAL_REF = /^#[A-Za-z_][\w.:-]*$/;
const SAFE_URL_FUNCTION = /^url\(\s*(['"]?)#[A-Za-z_][\w.:-]*\1\s*\)/i;

export type Orientation = "landscape" | "portrait";

export interface SanitizedSvg {
  document: Document;
  /** El SVG ya saneado, serializado. Es lo que se guarda. */
  svg: string;
  /** Qué se ha eliminado, en frases cortas para el admin. */
  removed: string[];
  orientation: Orientation;
  viewBox: { x: number; y: number; width: number; height: number };
}

export function parseSvg(source: string): Document {
  if (Buffer.byteLength(source, "utf8") > MAX_SVG_BYTES) {
    throw new TemplateError(`El SVG ocupa más de ${MAX_SVG_BYTES / 1024 / 1024} MB.`);
  }
  // Ni DOCTYPE ni entidades: es la puerta de XXE y de la "bomba de mil millones de risas".
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new TemplateError("El SVG no puede tener DOCTYPE ni entidades. Expórtalo como «SVG simple».");
  }
  let document: Document;
  try {
    document = new DOMParser({
      onError(level, message) {
        if (level !== "warning") throw new TemplateError(`El SVG no es un XML válido: ${message}`);
      },
    }).parseFromString(source, "image/svg+xml");
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(`El SVG no es un XML válido: ${(error as Error).message}`);
  }
  const root = document.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NS) {
    throw new TemplateError('El fichero no es un SVG: falta <svg xmlns="http://www.w3.org/2000/svg">.');
  }
  return document;
}

export function sanitizeSvg(source: string): SanitizedSvg {
  const document = parseSvg(source);
  const root = document.documentElement!;
  const removed = new Map<string, number>();
  const note = (what: string) => removed.set(what, (removed.get(what) ?? 0) + 1);

  sanitizeChildren(root, note);
  sanitizeAttributes(root, note);
  // El parser da por hecho el espacio de nombres SVG; el navegador no, así que se escribe siempre.
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);

  const viewBox = readViewBox(root);
  const orientation = a4Orientation(viewBox.width, viewBox.height);

  return {
    document,
    svg: new XMLSerializer().serializeToString(document),
    removed: [...removed].map(([what, count]) => (count > 1 ? `${what} (${count})` : what)),
    orientation,
    viewBox,
  };
}

function sanitizeChildren(parent: Element, note: (what: string) => void): void {
  for (const child of [...childNodes(parent)]) {
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) continue;
    if (child.nodeType !== ELEMENT_NODE) {
      // Comentarios e instrucciones de proceso: fuera, sin avisar.
      parent.removeChild(child);
      continue;
    }
    const element = child as Element;
    const name = element.localName ?? element.nodeName;
    const isSvg = element.namespaceURI === SVG_NS;

    if (isSvg && UNWRAP_ELEMENTS.has(name)) {
      note(`enlace <${name}> (se conserva lo que contenía)`);
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
      continue;
    }
    if (!isSvg || !ALLOWED_ELEMENTS.has(name)) {
      note(isSvg ? `elemento <${name}>` : `elemento de otro programa <${element.nodeName}>`);
      parent.removeChild(element);
      continue;
    }
    if (name === "style" && !isSafeCss(element.textContent ?? "")) {
      note("hoja de estilos <style> con @import, @font-face o url() externas");
      parent.removeChild(element);
      continue;
    }
    if (name === "image" && !DATA_IMAGE.test(hrefOf(element) ?? "")) {
      note("imagen que no está incrustada como PNG o JPEG");
      parent.removeChild(element);
      continue;
    }
    sanitizeAttributes(element, note);
    sanitizeChildren(element, note);
  }
}

function sanitizeAttributes(element: Element, note: (what: string) => void): void {
  const name = element.localName;
  for (const attr of [...attributes(element)]) {
    const attrName = attr.localName ?? attr.name;
    const value = attr.value;
    const ns = attr.namespaceURI;
    const remove = (why: string) => {
      note(why);
      element.removeAttributeNode(attr);
    };

    if (ns === XMLNS_NS || attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
    if (ns && ns !== XLINK_NS && ns !== XML_NS) {
      remove(`atributo de otro programa (${attr.name})`);
      continue;
    }
    if (ns === XML_NS && attrName !== "space" && attrName !== "lang") {
      remove(`atributo ${attr.name}`);
      continue;
    }
    if (/^on/i.test(attrName)) {
      remove(`manejador de eventos ${attr.name}`);
      continue;
    }
    if (attrName === "href") {
      const ok = name === "image" ? DATA_IMAGE.test(value) : LOCAL_REF.test(value.trim());
      if (!ok) remove("enlace externo (href)");
      continue;
    }
    if (ns === XLINK_NS) {
      remove(`atributo ${attr.name}`);
      continue;
    }
    if (/javascript:|vbscript:|data:/i.test(value.replace(/\s+/g, ""))) {
      remove(`atributo ${attrName} con un enlace no permitido`);
      continue;
    }
    if (attrName === "style" ? !isSafeCss(value) : !hasOnlyLocalUrls(value)) {
      remove(`atributo ${attrName} con url() externas`);
    }
  }
}

/** CSS sin nada que cargue recursos de fuera ni trucos de escape. */
function isSafeCss(css: string): boolean {
  if (/[\\@]|expression\s*\(|image-set|-moz-binding|behavior\s*:/i.test(css)) return false;
  return hasOnlyLocalUrls(css);
}

function hasOnlyLocalUrls(value: string): boolean {
  const pattern = /url\s*\(/gi;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (!SAFE_URL_FUNCTION.test(value.slice(match.index))) return false;
  }
  return true;
}

function hrefOf(element: Element): string | null {
  return element.getAttribute("href") ?? element.getAttributeNS(XLINK_NS, "href");
}

function readViewBox(root: Element) {
  const raw = root.getAttribute("viewBox");
  const parts = raw?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2]! <= 0 || parts[3]! <= 0) {
    throw new TemplateError('El SVG necesita un viewBox válido, por ejemplo viewBox="0 0 297 210".');
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height };
}

/** Un A4 en horizontal (297×210) o en vertical, con un 1 % de margen. */
export function a4Orientation(width: number, height: number): Orientation {
  const ratio = width / height;
  const a4 = 297 / 210;
  if (Math.abs(ratio - a4) / a4 <= 0.01) return "landscape";
  if (Math.abs(ratio - 1 / a4) / (1 / a4) <= 0.01) return "portrait";
  throw new TemplateError(
    `El viewBox (${width}×${height}) no tiene las proporciones de un A4. Usa viewBox="0 0 297 210" (horizontal) o "0 0 210 297" (vertical).`,
  );
}

export function childNodes(node: Node): Node[] {
  const result: Node[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function attributes(element: Element) {
  const result = [];
  for (let i = 0; i < element.attributes.length; i++) result.push(element.attributes.item(i)!);
  return result;
}

export function elementChildren(node: Node): Element[] {
  return childNodes(node).filter((n): n is Element => n.nodeType === ELEMENT_NODE);
}

export function descendants(node: Node): Element[] {
  return elementChildren(node).flatMap((child) => [child, ...descendants(child)]);
}

export { ELEMENT_NODE, TEXT_NODE, CDATA_SECTION_NODE };
