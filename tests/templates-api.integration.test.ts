// Rutas del admin de plantillas, de punta a punta: petición HTTP → base de datos → PDF (KAN-13).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldConfig } from "@/lib/templates/fields";
import { createFakeAccessTeam, TEST_AUD, TEST_TEAM, type FakeAccessTeam } from "@/lib/security/testing";
import { decodeQrFromPdf, EXAMPLE_DIR, EXAMPLE_FONT_FILES, exampleSvg, hasPoppler } from "@/lib/templates/testing";

let team: FakeAccessTeam;
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: () => (header: never, token: never) => team.getKey(header, token) };
});

const url = process.env.DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("En la CI los tests de integración necesitan DATABASE_URL.");
}

const PUBLIC_URL = "https://certificados.popiai.es";
const ADMIN_HOST = "certificados-admin.luismi.dev";

describe.skipIf(!url)("API de plantillas del admin", async () => {
  Object.assign(process.env, {
    PUBLIC_URL,
    ADMIN_HOST,
    CF_ACCESS_TEAM_DOMAIN: TEST_TEAM,
    CF_ACCESS_AUD: TEST_AUD,
    ADMIN_EMAILS: "info@popiai.es",
  });
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
  const { getPrisma } = await import("@/lib/db");
  const prisma = getPrisma();
  const templates = await import("@/app/api/admin/plantillas/route");
  const versions = await import("@/app/api/admin/plantillas/[templateId]/versiones/route");
  const detail = await import("@/app/api/admin/plantillas/versiones/[versionId]/route");
  const fieldsRoute = await import("@/app/api/admin/plantillas/versiones/[versionId]/campos/route");
  const previewPdf = await import("@/app/api/admin/plantillas/versiones/[versionId]/vista-previa.pdf/route");
  const previewSvg = await import("@/app/api/admin/plantillas/versiones/[versionId]/vista-previa.svg/route");
  const { lockTemplateVersion } = await import("@/lib/templates/repository");

  const reset = () => prisma.$executeRawUnsafe("TRUNCATE template_font, template_version, template, audit_log RESTART IDENTITY CASCADE");
  beforeAll(async () => {
    team = await createFakeAccessTeam();
  });
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  async function request(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string>; token?: string | null } = {}) {
    const token = init.token === undefined ? await team.sign() : init.token;
    const draft = new Request(`https://${ADMIN_HOST}${path}`, { method: init.method ?? "GET", body: init.body });
    // Como un navegador: Content-Length con el tamaño real del cuerpo.
    const body = init.body ? await draft.arrayBuffer() : undefined;
    return new NextRequest(`https://${ADMIN_HOST}${path}`, {
      method: init.method ?? "GET",
      body,
      headers: {
        host: ADMIN_HOST,
        ...(token ? { "cf-access-jwt-assertion": token } : {}),
        ...(body ? { "content-type": draft.headers.get("content-type")!, "content-length": String(body.byteLength) } : {}),
        ...init.headers,
      },
    });
  }

  function uploadForm(svg: string, options: { name?: string; fonts?: boolean } = {}) {
    const form = new FormData();
    if (options.name !== undefined) form.set("name", options.name);
    form.set("svg", new File([svg], "diploma.svg", { type: "image/svg+xml" }));
    if (options.fonts !== false) {
      for (const file of EXAMPLE_FONT_FILES) {
        form.append("fonts", new File([readFileSync(join(EXAMPLE_DIR, "fuentes", file))], `../../${file}`, { type: "font/woff" }));
      }
    }
    return form;
  }

  const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

  it("sube una plantilla, la lista, la configura y genera las vistas previas", async () => {
    const created = await templates.POST(await request("/api/admin/plantillas", { method: "POST", body: uploadForm(exampleSvg(), { name: "Diploma estándar" }) }), undefined);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { templateId: string; versionId: string; fields: FieldConfig[]; report: { removed: string[]; warnings: string[] } };
    expect(body.fields.map((f) => f.key)).toEqual(["nombre", "formacion", "horas", "lugar", "fecha", "ponente"]);
    expect(body.report).toEqual({ removed: [], warnings: [] });

    const list = (await (await templates.GET(await request("/api/admin/plantillas"), undefined)).json()) as { templates: { name: string }[] };
    expect(list.templates.map((t) => t.name)).toEqual(["Diploma estándar"]);

    const info = await detail.GET(await request(`/api/admin/plantillas/versiones/${body.versionId}`), params({ versionId: body.versionId }));
    const infoBody = (await info.json()) as { fonts: { fileName: string; data?: unknown }[]; svg?: string };
    // El nombre del fichero no arrastra rutas, y no se devuelven los ficheros.
    expect(infoBody.fonts.map((f) => f.fileName).sort()).toEqual([...EXAMPLE_FONT_FILES].sort());
    expect(infoBody.fonts[0]!.data).toBeUndefined();
    expect(infoBody.svg).toBeUndefined();

    const config = body.fields.map((f) => (f.key === "nombre" ? { ...f, label: "Nombre y apellidos" } : f));
    const saved = await fieldsRoute.PUT(
      await request(`/api/admin/plantillas/versiones/${body.versionId}/campos`, { method: "PUT", body: JSON.stringify({ fields: config }) }),
      params({ versionId: body.versionId }),
    );
    expect(saved.status).toBe(200);

    const svg = await previewSvg.GET(await request(`/api/admin/plantillas/versiones/${body.versionId}/vista-previa.svg`), params({ versionId: body.versionId }));
    expect(svg.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    expect(svg.headers.get("content-security-policy")).toMatch(/default-src 'none'.*sandbox/);
    const svgText = await svg.text();
    expect(svgText).toContain("María José Fernández-Castañeda Núñez");
    expect(svgText).toContain("@font-face");

    const pdf = await previewPdf.GET(await request(`/api/admin/plantillas/versiones/${body.versionId}/vista-previa.pdf`), params({ versionId: body.versionId }));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    if (hasPoppler()) expect(decodeQrFromPdf(pdfBytes)).toBe(`${PUBLIC_URL}/c/ABCD234567`);
  });

  it("una versión nueva hereda los campos; una versión usada ya no se configura", async () => {
    const created = (await (await templates.POST(await request("/api/admin/plantillas", { method: "POST", body: uploadForm(exampleSvg(), { name: "D" }) }), undefined)).json()) as {
      templateId: string;
      versionId: string;
      fields: Record<string, unknown>[];
    };
    await lockTemplateVersion(prisma, created.versionId);
    const blocked = await fieldsRoute.PUT(
      await request(`/api/admin/plantillas/versiones/${created.versionId}/campos`, { method: "PUT", body: JSON.stringify({ fields: created.fields }) }),
      params({ versionId: created.versionId }),
    );
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/versión nueva/);

    const v2 = await versions.POST(
      await request(`/api/admin/plantillas/${created.templateId}/versiones`, { method: "POST", body: uploadForm(exampleSvg().replace("{{ponente}}", "{{formador}}")) }),
      params({ templateId: created.templateId }),
    );
    expect(v2.status).toBe(201);
    const v2Body = (await v2.json()) as { version: number; fields: { key: string }[] };
    expect(v2Body.version).toBe(2);
    expect(v2Body.fields.map((f) => f.key)).toContain("formador");
  });

  it("explica los errores de la plantilla en vez de fallar", async () => {
    const noQr = exampleSvg().replace(/<rect id="qr"[^>]*\/>/, "");
    const response = await templates.POST(await request("/api/admin/plantillas", { method: "POST", body: uploadForm(noQr, { name: "Sin QR" }) }), undefined);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(/id="qr"/);

    const noName = await templates.POST(await request("/api/admin/plantillas", { method: "POST", body: uploadForm(exampleSvg()) }), undefined);
    expect(noName.status).toBe(422);

    const tooBig = await templates.POST(
      await request("/api/admin/plantillas", { method: "POST", body: uploadForm(exampleSvg(), { name: "x" }), headers: { "content-length": String(50 * 1024 * 1024) } }),
      undefined,
    );
    expect(tooBig.status).toBe(422);
    expect(((await tooBig.json()) as { error: string }).error).toMatch(/MB/);
    expect(await prisma.template.count()).toBe(0);
  });

  it("sanea al subir y avisa de lo que ha quitado", async () => {
    const dirty = exampleSvg().replace("</svg>", '<script>alert(1)</script><image href="https://evil.example/x.png" width="1" height="1"/></svg>');
    const response = await templates.POST(await request("/api/admin/plantillas", { method: "POST", body: uploadForm(dirty, { name: "Sucia" }) }), undefined);
    expect(response.status).toBe(201);
    const { versionId, report } = (await response.json()) as { versionId: string; report: { removed: string[] } };
    expect(report.removed.join(" ")).toMatch(/<script>/);
    const stored = await prisma.templateVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(stored.svg).not.toMatch(/script|evil\.example/);
  });

  it("ids raros o inexistentes dan 404, y sin token, 403", async () => {
    const bad = await detail.GET(await request("/api/admin/plantillas/versiones/no-es-uuid"), params({ versionId: "no-es-uuid" }));
    expect(bad.status).toBe(404);
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await previewPdf.GET(await request(`/x`), params({ versionId: missing }))).status).toBe(404);
    expect((await versions.POST(await request("/x", { method: "POST", body: uploadForm(exampleSvg()) }), params({ templateId: missing }))).status).toBe(404);
    expect((await templates.GET(await request("/api/admin/plantillas", { token: null }), undefined)).status).toBe(403);
    expect((await templates.POST(await request("/api/admin/plantillas", { method: "POST", body: uploadForm(exampleSvg(), { name: "x" }), token: null }), undefined)).status).toBe(403);
    expect(await prisma.template.count()).toBe(0);
  });
});
