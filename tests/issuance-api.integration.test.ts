// Rutas del admin de formaciones y certificados, de punta a punta: petición HTTP → base de datos (KAN-11).
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_SEED_A } from "@/lib/ob/testing";
import { createFakeAccessTeam, TEST_AUD, TEST_TEAM, type FakeAccessTeam } from "@/lib/security/testing";
import { exampleFonts, exampleSvg } from "@/lib/templates/testing";

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
const PUBLIC_HOST = "certificados.popiai.es";

describe.skipIf(!url)("API de formaciones y certificados del admin", async () => {
  Object.assign(process.env, {
    PUBLIC_URL,
    ADMIN_HOST,
    CF_ACCESS_TEAM_DOMAIN: TEST_TEAM,
    CF_ACCESS_AUD: TEST_AUD,
    ADMIN_EMAILS: "info@popiai.es",
    POPICERT_SIGNING_KEY: TEST_SEED_A,
  });
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
  const { getPrisma } = await import("@/lib/db");
  const prisma = getPrisma();
  const { prepareTemplate } = await import("@/lib/templates/prepare");
  const { createTemplate } = await import("@/lib/templates/repository");
  const { proxy } = await import("@/proxy");

  const routes = {
    achievements: await import("@/app/api/admin/formaciones/route"),
    achievement: await import("@/app/api/admin/formaciones/[id]/route"),
    archived: await import("@/app/api/admin/formaciones/[id]/archivada/route"),
    badge: await import("@/app/api/admin/formaciones/[id]/insignia/route"),
    issue: await import("@/app/api/admin/formaciones/[id]/certificados/route"),
    exportCsv: await import("@/app/api/admin/formaciones/[id]/certificados.csv/route"),
    sampleCsv: await import("@/app/api/admin/formaciones/[id]/csv/ejemplo.csv/route"),
    preview: await import("@/app/api/admin/formaciones/[id]/csv/vista-previa/route"),
    issueCsv: await import("@/app/api/admin/formaciones/[id]/csv/emitir/route"),
    search: await import("@/app/api/admin/certificados/route"),
    certificate: await import("@/app/api/admin/certificados/[id]/route"),
    pdf: await import("@/app/api/admin/certificados/[id]/certificado.pdf/route"),
    json: await import("@/app/api/admin/certificados/[id]/credencial.json/route"),
    revoke: await import("@/app/api/admin/certificados/[id]/revocacion/route"),
    hide: await import("@/app/api/admin/certificados/[id]/ocultacion/route"),
    audit: await import("@/app/api/admin/auditoria/route"),
  };
  const publicBadge = await import("@/app/insignias/[file]/route");

  const reset = () =>
    prisma.$executeRawUnsafe(
      "TRUNCATE credential, achievement, badge_image, status_entry, status_list, template_font, template_version, template, audit_log RESTART IDENTITY CASCADE",
    );
  beforeAll(async () => {
    team = await createFakeAccessTeam();
  });
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  async function request(
    path: string,
    init: { method?: string; body?: BodyInit; json?: unknown; token?: string | null; host?: string; headers?: Record<string, string> } = {},
  ): Promise<NextRequest> {
    const token = init.token === undefined ? await team.sign() : init.token;
    const host = init.host ?? ADMIN_HOST;
    const method = init.method ?? (init.body || init.json !== undefined ? "POST" : "GET");
    const draft = new Request(`https://${host}${path}`, { method, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    const body = method === "GET" ? undefined : await draft.arrayBuffer();
    return new NextRequest(`https://${host}${path}`, {
      method,
      body: body && body.byteLength ? body : undefined,
      headers: {
        host,
        // Como el navegador desde el propio admin (protección CSRF).
        origin: `https://${host}`,
        "sec-fetch-site": "same-origin",
        ...(token ? { "cf-access-jwt-assertion": token } : {}),
        ...(body && body.byteLength
          ? { "content-type": init.json !== undefined ? "application/json" : draft.headers.get("content-type")!, "content-length": String(body.byteLength) }
          : {}),
        ...init.headers,
      },
    });
  }

  const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

  async function setup() {
    const prepared = await prepareTemplate({ svg: exampleSvg(), fonts: await exampleFonts(), publicUrl: PUBLIC_URL });
    const { versionId } = await createTemplate(prisma, { name: "Diploma estándar", prepared, actorEmail: "info@popiai.es" });
    const response = await routes.achievements.POST(
      await request("/api/admin/formaciones", {
        json: {
          name: "IA generativa para pymes",
          description: "Formación presencial.",
          criteria: "Asistir a la formación completa.",
          hours: 8,
          templateVersionId: versionId,
          trainingValues: { fecha: "27 de noviembre de 2026", lugar: "Valencia" },
        },
      }),
      undefined,
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { achievement: { id: string } }).achievement.id;
  }

  function csvForm(csv: string) {
    const form = new FormData();
    form.set("csv", new File([csv], "asistentes.csv", { type: "text/csv" }));
    return form;
  }

  it("de la formación al CSV emitido, exportado y revocado", async () => {
    const id = await setup();

    const sample = await routes.sampleCsv.GET(await request(`/api/admin/formaciones/${id}/csv/ejemplo.csv`), params({ id }));
    expect(sample.headers.get("content-disposition")).toContain("asistentes-ia-generativa-para-pymes.csv");
    const sampleBytes = Buffer.from(await sample.arrayBuffer());
    // Con BOM, para que Excel lo abra en UTF-8 con doble clic.
    expect(sampleBytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
    const sampleText = sampleBytes.toString("utf8");
    expect(sampleText.split("\r\n")[0]).toBe("﻿nombre;email");

    // El CSV de ejemplo, tal cual, sirve para emitir.
    const preview = await routes.preview.POST(await request(`/api/admin/formaciones/${id}/csv/vista-previa`, { body: csvForm(sampleText) }), params({ id }));
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { counts: { ok: number } }).counts.ok).toBe(1);
    expect(await prisma.credential.count()).toBe(0);

    // Excel en español: punto y coma y Windows-1252.
    const latin1 = Buffer.from("Nombre;Email\r\nJosé Núñez;jose@example.com\r\nAna Peña;\r\n", "latin1");
    const issued = await routes.issueCsv.POST(await request(`/api/admin/formaciones/${id}/csv/emitir`, { body: csvForm(latin1 as unknown as string) }), params({ id }));
    const report = (await issued.json()) as { counts: Record<string, number>; rows: { name: string; certificate: { id: string; code: string; url: string } }[] };
    expect(report.counts).toMatchObject({ issued: 2, error: 0 });
    expect(report.rows.map((r) => r.name)).toEqual(["José Núñez", "Ana Peña"]);
    const jose = report.rows[0]!.certificate;
    expect(jose.url).toBe(`${PUBLIC_URL}/c/${jose.code}`);

    const again = await routes.issueCsv.POST(await request(`/api/admin/formaciones/${id}/csv/emitir`, { body: csvForm(latin1 as unknown as string) }), params({ id }));
    expect(((await again.json()) as { counts: Record<string, number> }).counts).toMatchObject({ issued: 0, existing: 2 });

    const exported = await routes.exportCsv.GET(await request(`/api/admin/formaciones/${id}/certificados.csv`), params({ id }));
    expect(exported.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(await exported.text()).toContain(`José Núñez;jose@example.com;${jose.url};${jose.code};Válido;`);

    const found = await routes.search.GET(await request(`/api/admin/certificados?q=${jose.code}`), undefined);
    expect(((await found.json()) as { certificates: { id: string }[] }).certificates.map((c) => c.id)).toEqual([jose.id]);

    const pdf = await routes.pdf.GET(await request(`/api/admin/certificados/${jose.id}/certificado.pdf`), params({ id: jose.id }));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const signed = await routes.json.GET(await request(`/api/admin/certificados/${jose.id}/credencial.json`), params({ id: jose.id }));
    expect(((await signed.json()) as { id: string; proof: unknown }).id).toBe(jose.url);

    const revoked = await routes.revoke.POST(await request(`/api/admin/certificados/${jose.id}/revocacion`, { json: { reason: "Error en el nombre" } }), params({ id: jose.id }));
    expect(revoked.status).toBe(200);
    const detail = (await (await routes.certificate.GET(await request(`/api/admin/certificados/${jose.id}`), params({ id: jose.id }))).json()) as {
      certificate: { revocationReason: string };
    };
    expect(detail.certificate.revocationReason).toBe("Error en el nombre");

    const hidden = await routes.hide.POST(await request(`/api/admin/certificados/${jose.id}/ocultacion`, { json: { reason: "Petición" } }), params({ id: jose.id }));
    expect(hidden.status).toBe(200);

    // Todo queda auditado, con el email del JWT de Access.
    const audit = (await (await routes.audit.GET(await request("/api/admin/auditoria"), undefined)).json()) as { entries: { action: string; actorEmail: string }[] };
    expect(audit.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(["achievement.create", "certificate.issue", "certificate.batch", "certificate.revoke", "certificate.hide"]),
    );
    expect(new Set(audit.entries.map((e) => e.actorEmail))).toEqual(new Set(["info@popiai.es"]));
  });

  it("emisión individual: 201 si emite, 200 con el que había si ya existía, 422 con el motivo si los datos no valen", async () => {
    const id = await setup();
    const first = await routes.issue.POST(await request(`/api/admin/formaciones/${id}/certificados`, { json: { values: { nombre: "Ana López" } } }), params({ id }));
    expect(first.status).toBe(201);
    const again = await routes.issue.POST(await request(`/api/admin/formaciones/${id}/certificados`, { json: { values: { nombre: "ana lópez" } } }), params({ id }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { status: string }).status).toBe("existing");
    const bad = await routes.issue.POST(await request(`/api/admin/formaciones/${id}/certificados`, { json: { values: {} } }), params({ id }));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toMatch(/falta «Nombre»/);
    const missing = await routes.issue.POST(
      await request(`/api/admin/formaciones/00000000-0000-4000-8000-000000000000/certificados`, { json: { values: { nombre: "X" } } }),
      params({ id: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(missing.status).toBe(404);
  });

  it("la insignia se sube en el admin y se publica en el host público por su sha256", async () => {
    const id = await setup();
    const form = new FormData();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    form.set("image", new File([png], "insignia.png", { type: "image/png" }));
    const uploaded = await routes.badge.PUT(await request(`/api/admin/formaciones/${id}/insignia`, { method: "PUT", body: form }), params({ id }));
    expect(uploaded.status).toBe(200);
    const sha = ((await uploaded.json()) as { achievement: { badgeSha256: string } }).achievement.badgeSha256;

    const served = await publicBadge.GET(new Request(`${PUBLIC_URL}/insignias/${sha}.png`), params({ file: `${sha}.png` }));
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
    expect((await publicBadge.GET(new Request(`${PUBLIC_URL}/insignias/${sha}.jpg`), params({ file: `${sha}.jpg` }))).status).toBe(404);
    expect((await publicBadge.GET(new Request(`${PUBLIC_URL}/insignias/../x`), params({ file: "..%2Fx" }))).status).toBe(404);
  });

  it("archivar y recuperar; borrar solo sin certificados", async () => {
    const id = await setup();
    await routes.issue.POST(await request(`/api/admin/formaciones/${id}/certificados`, { json: { values: { nombre: "Ana" } } }), params({ id }));
    const del = await routes.achievement.DELETE(await request(`/api/admin/formaciones/${id}`, { method: "DELETE" }), params({ id }));
    expect(del.status).toBe(422);
    expect((await routes.archived.PUT(await request(`/api/admin/formaciones/${id}/archivada`, { method: "PUT" }), params({ id }))).status).toBe(200);
    const blocked = await routes.issue.POST(await request(`/api/admin/formaciones/${id}/certificados`, { json: { values: { nombre: "Luis" } } }), params({ id }));
    expect(blocked.status).toBe(422);
    expect((await routes.archived.DELETE(await request(`/api/admin/formaciones/${id}/archivada`, { method: "DELETE" }), params({ id }))).status).toBe(200);
  });

  describe("seguridad", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    // Cada handler, con el método que exporta. Que no se escape ninguno.
    const handlers = Object.entries(routes).flatMap(([name, mod]) =>
      (["GET", "POST", "PUT", "DELETE"] as const)
        .filter((method) => method in mod)
        .map((method) => ({ name: `${name} ${method}`, method, handler: (mod as unknown as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>)[method]! })),
    );

    it("cubre todas las rutas", () => {
      expect(handlers.length).toBeGreaterThanOrEqual(22);
    });

    it.each([
      ["sin JWT", () => Promise.resolve(null)],
      ["con un JWT caducado", () => team.sign({ email: "info@popiai.es" }, { expiresIn: Math.floor(Date.now() / 1000) - 3600 })],
      ["con otra audiencia", () => team.sign({ email: "info@popiai.es" }, { audience: "otra-aplicacion" })],
      ["con un email no permitido", () => team.sign({ email: "intruso@example.com" })],
    ])("todas dan 403 %s", async (_label, makeToken) => {
      const token = await makeToken();
      for (const { name, method, handler } of handlers) {
        const response = await handler(await request(`/api/admin/x`, { method, token, ...(method === "GET" ? {} : { json: { values: { nombre: "X" }, reason: "x" } }) }), params({ id }));
        expect(response.status, name).toBe(403);
      }
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it("CSRF: una web de fuera no puede escribir aunque el navegador mande la cookie de Access", async () => {
      const id = await setup();
      const path = `/api/admin/formaciones/${id}/certificados`;
      const attempts: [string, Record<string, string>][] = [
        ["desde otra web", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }],
        ["desde otro subdominio del mismo sitio", { origin: "https://otro.luismi.dev", "sec-fetch-site": "same-site" }],
        ["con Origin falseado pero Sec-Fetch-Site delator", { "sec-fetch-site": "cross-site" }],
        ["sin Origin", { origin: "", "sec-fetch-site": "" }],
        ["con Origin null (iframe con sandbox)", { origin: "null", "sec-fetch-site": "cross-site" }],
      ];
      for (const [label, headers] of attempts) {
        const req = await request(path, { json: { values: { nombre: "Atacante" } }, headers });
        // Las cabeceras vacías son «no enviadas».
        for (const [k, v] of Object.entries(headers)) if (v === "") req.headers.delete(k);
        expect((await routes.issue.POST(req, params({ id }))).status, label).toBe(403);
      }
      // Un formulario o fetch sin preflight solo puede mandar text/plain: tampoco sirve.
      const plain = await request(path, { body: JSON.stringify({ values: { nombre: "Atacante" } }) });
      expect((await routes.issue.POST(plain, params({ id }))).status).toBe(422);
      expect(await prisma.credential.count()).toBe(0);
      // Leer sí se puede sin Origin (navegación normal y descargas).
      const read = await request(`/api/admin/formaciones/${id}`, { headers: { origin: "" } });
      read.headers.delete("origin");
      expect((await routes.achievement.GET(read, params({ id }))).status).toBe(200);
    });

    it("en el host público, el admin no existe (404) aunque traiga un JWT válido", async () => {
      for (const path of ["/api/admin/formaciones", `/api/admin/formaciones/${id}/csv/emitir`, `/api/admin/certificados/${id}/revocacion`, "/admin/formaciones"]) {
        const response = await proxy(await request(path, { method: "POST", host: PUBLIC_HOST, json: {} }));
        expect(response.status, path).toBe(404);
      }
      // Y si la petición se colara hasta el handler, tampoco: el handler vuelve a comprobar el host.
      const direct = await routes.issueCsv.POST(await request(`/api/admin/formaciones/${id}/csv/emitir`, { host: PUBLIC_HOST, json: {} }), params({ id }));
      expect(direct.status).toBe(403);
    });
  });
});
