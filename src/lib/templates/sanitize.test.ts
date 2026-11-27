import { describe, expect, it } from "vitest";
import { TemplateError } from "./errors";
import { MAX_SVG_BYTES, sanitizeSvg } from "./sanitize";
import { exampleSvg } from "./testing";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function svg(body: string, rootAttrs = 'viewBox="0 0 297 210"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${rootAttrs}>${body}</svg>`;
}

describe("saneado de plantillas SVG", () => {
  it("la plantilla de ejemplo pasa sin cambios", () => {
    const result = sanitizeSvg(exampleSvg());
    expect(result.removed).toEqual([]);
    expect(result.orientation).toBe("landscape");
  });

  it("quita todo lo que ejecuta código", () => {
    const dirty = svg(`
      <script>alert(1)</script>
      <svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(2)</svg:script>
      <script xmlns="http://www.w3.org/1999/xhtml">alert(3)</script>
      <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(4)">x</div></foreignObject>
      <rect width="10" height="10" onload="alert(5)" ONCLICK="alert(6)" onMouseOver="alert(7)"/>
      <a href="javascript:alert(8)"><text x="1" y="1">enlace</text></a>
      <use href="javascript:alert(9)"/>
      <use xlink:href="data:image/svg+xml,&lt;svg onload=alert(10)&gt;"/>
      <rect width="1" height="1"><set attributeName="onload" to="alert(11)"/><animate attributeName="href" to="javascript:alert(12)"/></rect>
      <handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">alert(13)</handler>
      <iframe src="https://evil.example"/>
    `);
    const { svg: clean, removed } = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/alert|script|foreignObject|onload|onclick|onmouseover|javascript|<set|<animate|handler|iframe/i);
    // El texto del enlace se conserva; el enlace no.
    expect(clean).toContain("enlace");
    expect(clean).not.toContain("<a ");
    expect(removed.join(" | ")).toMatch(/<script>.*\(2\)/);
    expect(removed.join(" | ")).toMatch(/manejador de eventos/);
  });

  it("quita todo lo que carga recursos de fuera", () => {
    const dirty = svg(`
      <image href="https://evil.example/tracker.png" width="1" height="1"/>
      <image href="/etc/passwd" width="1" height="1"/>
      <image href="file:///etc/passwd" width="1" height="1"/>
      <image xlink:href="data:image/svg+xml;base64,PHN2Zy8+" width="1" height="1"/>
      <use href="https://evil.example/sprite.svg#a"/>
      <style>@import url(https://evil.example/a.css);</style>
      <style>@font-face { font-family: X; src: url(https://evil.example/x.ttf) }</style>
      <style>text { fill: u\\72l(https://evil.example/) }</style>
      <rect width="1" height="1" fill="url(https://evil.example/#x)"/>
      <rect width="1" height="1" fill="url(#ok) url(https://evil.example/)"/>
      <rect width="1" height="1" style="fill: url('https://evil.example/')"/>
      <rect width="1" height="1" style="background-image: image-set('https://evil.example/a.png' 1x)"/>
      <rect width="1" height="1" filter="url( 'https://evil.example/f.svg#f' )"/>
    `);
    const { svg: clean } = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/evil\.example|passwd|@import|@font-face|image-set|svg\+xml/);
  });

  it("conserva lo legítimo: degradados, referencias internas e imágenes incrustadas", () => {
    const ok = svg(`
      <defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><path id="p" d="M0 0h1"/></defs>
      <rect width="10" height="10" fill="url(#g)" style="stroke: url('#g'); stroke-width: 1"/>
      <use href="#p"/><use xlink:href="#p"/>
      <image href="${PNG_1PX}" width="5" height="5"/>
      <style>.titulo { fill: #123456 }</style>
      <text x="1" y="1" class="titulo" xml:space="preserve" data-max-width="100">{{nombre}}</text>
    `);
    const { svg: clean, removed } = sanitizeSvg(ok);
    expect(removed).toEqual([]);
    for (const piece of ['fill="url(#g)"', 'href="#p"', PNG_1PX, ".titulo", 'data-max-width="100"', "{{nombre}}"]) {
      expect(clean).toContain(piece);
    }
  });

  it("quita los restos de otros programas sin romper el dibujo", () => {
    const inkscape = svg(
      `<sodipodi:namedview id="base"/><g inkscape:label="Capa 1" inkscape:groupmode="layer"><rect width="1" height="1"/></g><metadata>…</metadata>`,
      'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 297 210"',
    );
    const { svg: clean, removed } = sanitizeSvg(inkscape);
    expect(clean).toContain("<rect");
    expect(clean).not.toMatch(/inkscape:label|namedview|<metadata/);
    expect(removed.length).toBeGreaterThan(0);
  });

  it.each([
    ["DOCTYPE con entidades", '<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210">&a;</svg>', /DOCTYPE/],
    ["XXE", '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', /DOCTYPE/],
    ["XML roto", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210"><g></svg>', /XML válido/],
    ["no es SVG", '<html xmlns="http://www.w3.org/1999/xhtml"></html>', /no es un SVG/],
    ["sin viewBox", '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm"></svg>', /viewBox/],
    ["viewBox raro", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 abc"></svg>', /viewBox/],
    ["no es A4", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"></svg>', /A4/],
  ])("rechaza: %s", (_, source, message) => {
    expect(() => sanitizeSvg(source)).toThrow(TemplateError);
    expect(() => sanitizeSvg(source)).toThrow(message);
  });

  it("un SVG sin xmlns se trata como SVG y sale con su xmlns, para que el navegador lo pinte", () => {
    expect(sanitizeSvg('<svg viewBox="0 0 297 210"><rect width="1" height="1"/></svg>').svg).toMatch(
      /^<svg[^>]* xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
    );
  });

  it("acepta A4 vertical y viewBox en píxeles con proporción de A4", () => {
    expect(sanitizeSvg(svg("", 'viewBox="0 0 210 297"')).orientation).toBe("portrait");
    expect(sanitizeSvg(svg("", 'viewBox="0 0 1123 794"')).orientation).toBe("landscape");
  });

  it("rechaza ficheros demasiado grandes", () => {
    const big = svg(`<desc>${"x".repeat(MAX_SVG_BYTES)}</desc>`);
    expect(() => sanitizeSvg(big)).toThrow(/MB/);
  });

  it("es idempotente: sanear lo saneado no cambia nada", () => {
    const once = sanitizeSvg(svg('<script>x</script><rect width="1" height="1" onclick="x"/>')).svg;
    const twice = sanitizeSvg(once);
    expect(twice.svg).toBe(once);
    expect(twice.removed).toEqual([]);
  });
});
