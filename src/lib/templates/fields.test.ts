import { describe, expect, it } from "vitest";
import { TemplateError } from "./errors";
import {
  defaultFieldConfig,
  detectMarkers,
  mergeFieldConfig,
  normalizeFieldValue,
  resolveFieldValues,
  validateFieldConfig,
} from "./fields";
import { sanitizeSvg } from "./sanitize";
import { exampleSvg } from "./testing";

function markersOf(body: string) {
  return detectMarkers(sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210">${body}</svg>`).document);
}

describe("campos de la plantilla", () => {
  it("detecta los campos de la plantilla de ejemplo y aparta los reservados", () => {
    const { fields, reserved, warnings } = detectMarkers(sanitizeSvg(exampleSvg()).document);
    expect(fields).toEqual(["nombre", "formacion", "horas", "lugar", "fecha", "ponente"]);
    expect(reserved.sort()).toEqual(["codigo", "url"]);
    expect(warnings).toEqual([]);
  });

  it("solo mira el texto visible, sin repetir campos, y admite espacios y mayúsculas", () => {
    const { fields } = markersOf(`
      <title>{{titulo}}</title>
      <text x="0" y="0">{{ Nombre }} y {{nombre}}</text>
      <text x="0" y="0"><tspan>{{dni}}</tspan></text>
    `);
    expect(fields).toEqual(["nombre", "dni"]);
  });

  it("avisa de marcadores con tildes, de {{qr}} y de marcadores partidos", () => {
    const { fields, warnings } = markersOf(`
      <text x="0" y="0">{{Formación}}</text>
      <text x="0" y="0">{{qr}}</text>
      <text x="0" y="0">{{nom<tspan font-weight="bold">bre}}</tspan></text>
    `);
    expect(fields).toEqual([]);
    expect(warnings.join("\n")).toMatch(/\{\{formacion\}\}/);
    expect(warnings.join("\n")).toMatch(/id="qr"/);
    expect(warnings.join("\n")).toMatch(/partido/);
  });

  it("propone una configuración por defecto razonable", () => {
    expect(defaultFieldConfig("nombre")).toEqual({ key: "nombre", label: "Nombre", scope: "attendee", required: true, public: true });
    expect(defaultFieldConfig("fecha")).toMatchObject({ scope: "training", public: true });
    expect(defaultFieldConfig("dni")).toMatchObject({ scope: "attendee", public: false });
    expect(defaultFieldConfig("numero_colegiado")).toEqual({
      key: "numero_colegiado",
      label: "Numero colegiado",
      scope: "attendee",
      required: true,
      public: false,
    });
  });

  it("una versión nueva conserva la configuración de los campos que siguen", () => {
    const previous = [{ ...defaultFieldConfig("nombre"), label: "Nombre completo" }, defaultFieldConfig("dni")];
    expect(mergeFieldConfig(["nombre", "empresa"], previous)).toEqual([previous[0], defaultFieldConfig("empresa")]);
  });

  it("la configuración tiene que cubrir exactamente los campos detectados", () => {
    const config = mergeFieldConfig(["nombre", "fecha"]);
    expect(validateFieldConfig(["nombre", "fecha"], [...config].reverse())).toEqual(config);
    expect(() => validateFieldConfig(["nombre", "fecha"], [config[0]])).toThrow(/faltan: fecha/);
    expect(() => validateFieldConfig(["nombre"], config)).toThrow(/sobran: fecha/);
    expect(() => validateFieldConfig(["nombre"], [config[0], config[0]])).toThrow(/repetidos/);
    expect(() => validateFieldConfig(["nombre"], [{ ...config[0], scope: "otro" }])).toThrow(TemplateError);
    expect(() => validateFieldConfig(["nombre"], "no")).toThrow(TemplateError);
  });

  it("limpia los valores: espacios, controles, caracteres invisibles y forma NFC", () => {
    expect(normalizeFieldValue("  Ana\n\t  Peña\u0000 ")).toBe("Ana Peña");
    expect(normalizeFieldValue("Jose\u0301")).toBe("José");
    expect(normalizeFieldValue("a\u202eb\u200bc")).toBe("a b c");
    expect(normalizeFieldValue(undefined)).toBe("");
    expect(normalizeFieldValue(8)).toBe("8");
  });

  it("exige los obligatorios, limita la longitud y añade los reservados", () => {
    const fields = mergeFieldConfig(["nombre", "lugar"]);
    const reserved = { codigo: "ABCD234567", url: "https://x/c/ABCD234567" };
    const values = resolveFieldValues(fields, { nombre: "Ana" }, reserved);
    expect(Object.fromEntries(values)).toEqual({ nombre: "Ana", lugar: "", ...reserved });
    expect(() => resolveFieldValues(fields, { nombre: "  " }, reserved)).toThrow(/falta «Nombre»/);
    expect(() => resolveFieldValues(fields, { nombre: "x".repeat(201) }, reserved)).toThrow(/más de 200/);
  });
});

describe("campos que nunca pueden ser públicos", () => {
  it("rechaza marcar el DNI (o similares) como público", () => {
    const config = ["nombre", "dni"].map((key) => ({ ...defaultFieldConfig(key) }));
    expect(() => validateFieldConfig(["nombre", "dni"], config)).not.toThrow();
    expect(() => validateFieldConfig(["nombre", "dni"], config.map((f) => (f.key === "dni" ? { ...f, public: true } : f)))).toThrow(
      /«DNI» no puede ser público/,
    );
  });
});
