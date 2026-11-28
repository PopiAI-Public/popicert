// Parte pública del certificado contra una PostgreSQL real (KAN-12).
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_SEED_A } from "@/lib/ob/testing";
import { decodeQrFromPdf, exampleFonts, exampleSvg, hasPoppler, pdfText } from "@/lib/templates/testing";

const url = process.env.DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("En la CI los tests de integración necesitan DATABASE_URL.");
}

const PUBLIC_URL = "https://certificados.popiai.es";
const ADMIN = "info@popiai.es";

describe.skipIf(!url)("página pública del certificado", async () => {
  Object.assign(process.env, { PUBLIC_URL, ADMIN_HOST: "certificados-admin.luismi.dev", POPICERT_SIGNING_KEY: TEST_SEED_A });
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
  const { getPrisma } = await import("@/lib/db");
  const prisma = getPrisma();
  const { getIssuerContext } = await import("@/lib/ob/issuer");
  const { prepareTemplate } = await import("@/lib/templates/prepare");
  const { createTemplate, getTemplateVersion, updateTemplateFields } = await import("@/lib/templates/repository");
  const { createAchievement } = await import("@/lib/issuance/achievements");
  const certs = await import("@/lib/issuance/certificates");
  const { getPublicCertificate } = await import("@/lib/public/certificate");
  const jsonRoute = await import("@/app/c/[code]/credencial.json/route");
  const pdfRoute = await import("@/app/c/[code]/certificado.pdf/route");
  const verifyRoute = await import("@/app/api/verificar/route");
  const page = await import("@/app/c/[code]/page");
  const { proxy } = await import("@/proxy");

  const reset = () =>
    prisma.$executeRawUnsafe(
      "TRUNCATE credential, achievement, badge_image, status_entry, status_list, template_font, template_version, template, audit_log RESTART IDENTITY CASCADE",
    );
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });
  let ctx: Awaited<ReturnType<typeof makeCtx>>;
  const makeCtx = async () => ({ prisma, issuer: await getIssuerContext(), actorEmail: ADMIN });
  beforeAll(async () => {
    ctx = await makeCtx();
  });

  /** Plantilla de ejemplo con un DNI privado y la empresa pública, y un certificado emitido. */
  async function issue(values: Record<string, string> = { nombre: "María José Núñez", dni: "12345678Z", empresa: "Peñalara S. L." }) {
    const svg = exampleSvg().replace("{{nombre}}", "{{nombre}} · DNI {{dni}} · {{empresa}}");
    const prepared = await prepareTemplate({ svg, fonts: await exampleFonts(), publicUrl: PUBLIC_URL });
    const { versionId } = await createTemplate(prisma, { name: "Con DNI", prepared, actorEmail: ADMIN });
    const version = await getTemplateVersion(prisma, versionId);
    await updateTemplateFields(prisma, { versionId, fields: version.fields.map((f) => (f.key === "empresa" ? { ...f, public: true } : f)), actorEmail: ADMIN });
    const achievement = await createAchievement(
      prisma,
      { name: "IA generativa para pymes", description: "Formación presencial.", criteria: "Asistir.", hours: 8, templateVersionId: versionId, trainingValues: { fecha: "27 de noviembre de 2026", lugar: "Valencia" } },
      ADMIN,
    );
    return (await certs.issueCertificate(ctx, achievement.id, { values })).certificate;
  }

  const params = (code: string) => ({ params: Promise.resolve({ code }) });

  it("enseña los campos públicos de la credencial firmada, nunca los privados", async () => {
    const certificate = await issue();
    const shown = await getPublicCertificate(prisma, certificate.code.toLowerCase());
    expect(shown).toMatchObject({ state: "valid", recipientName: "María José Núñez", url: `${PUBLIC_URL}/c/${certificate.code}` });
    if (shown?.state !== "valid") throw new Error("no visible");
    expect(shown.fields).toEqual([
      { label: "Empresa", value: "Peñalara S. L." },
      { label: "Horas", value: "8" },
      { label: "Lugar", value: "Valencia" },
      { label: "Fecha", value: "27 de noviembre de 2026" },
    ]);

    const response = await jsonRoute.GET(new Request(`${PUBLIC_URL}/c/${certificate.code}/credencial.json`), params(certificate.code));
    expect(response.headers.get("content-type")).toMatch(/application\/ld\+json/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.text();
    expect(JSON.parse(body).proof).toBeDefined();
    expect(body).toContain("Peñalara S. L.");
    expect(body).not.toMatch(/12345678Z/i);
  });

  it("la misma URL da la credencial con Accept JSON y la página con un navegador", async () => {
    const certificate = await issue();
    const as = (accept: string) =>
      proxy(new NextRequest(`${PUBLIC_URL}/c/${certificate.code}`, { headers: { host: "certificados.popiai.es", accept, "cf-connecting-ip": `203.0.113.${accept.length % 200}` } }));
    const json = await as("application/ld+json");
    expect(json.headers.get("x-middleware-rewrite")).toBe(`${PUBLIC_URL}/c/${certificate.code}/credencial.json`);
    expect(json.headers.get("vary")).toBe("Accept");
    const html = await as("text/html,application/xhtml+xml,*/*;q=0.8");
    expect(html.headers.get("x-middleware-rewrite")).toBeNull();
    expect(html.headers.get("vary")).toBe("Accept");
  });

  it("los metadatos para compartir usan siempre PUBLIC_URL", async () => {
    const certificate = await issue();
    const metadata = await page.generateMetadata(params(certificate.code));
    expect(metadata.metadataBase?.toString()).toBe(`${PUBLIC_URL}/`);
    expect(metadata.openGraph).toMatchObject({ url: `${PUBLIC_URL}/c/${certificate.code}`, title: "María José Núñez · IA generativa para pymes" });
    expect(metadata.alternates?.canonical).toBe(`${PUBLIC_URL}/c/${certificate.code}`);
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("el PDF público lleva el QR a la URL pública y deja en blanco el DNI", async () => {
    const certificate = await issue();
    const response = await pdfRoute.GET(new Request(`http://otro-host/c/${certificate.code}/certificado.pdf`), params(certificate.code));
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.includes(Buffer.from("12345678Z"))).toBe(false);
    if (hasPoppler()) {
      expect(decodeQrFromPdf(pdf)).toBe(`${PUBLIC_URL}/c/${certificate.code}`);
      const text = pdfText(pdf).replace(/\s+/g, " ");
      expect(text).toContain("María José Núñez");
      expect(text).not.toContain("12345678Z");
    }
    // El del admin sí lo lleva: es el que se entrega al asistente.
    if (hasPoppler()) {
      const full = await certs.renderCertificatePdf(prisma, await certs.getCertificate(prisma, certificate.id), "PopiAI");
      expect(pdfText(full)).toContain("12345678Z");
    }
  });

  it("revocado: la página lo dice con fecha y motivo", async () => {
    const certificate = await issue();
    await certs.revokeCertificate(ctx, certificate.id, "Nombre mal escrito");
    expect(await getPublicCertificate(prisma, certificate.code)).toMatchObject({ state: "revoked", revocationReason: "Nombre mal escrito" });
  });

  it("oculto: ni página, ni JSON, ni PDF dicen de quién es", async () => {
    const certificate = await issue();
    await certs.setCertificateHidden(prisma, certificate.id, { hidden: true, reason: "Petición", actorEmail: ADMIN });
    expect(await getPublicCertificate(prisma, certificate.code)).toEqual({ state: "hidden", code: certificate.code });
    const json = await jsonRoute.GET(new Request(`${PUBLIC_URL}/c/${certificate.code}/credencial.json`), params(certificate.code));
    expect(json.status).toBe(410);
    expect(await json.text()).not.toMatch(/Núñez|IA generativa/);
    expect((await pdfRoute.GET(new Request(`${PUBLIC_URL}/c/${certificate.code}/certificado.pdf`), params(certificate.code))).status).toBe(404);
    const metadata = await page.generateMetadata(params(certificate.code));
    expect(JSON.stringify(metadata)).not.toMatch(/Núñez|IA generativa/);
  });

  it("un código que no existe da 404", async () => {
    expect(await getPublicCertificate(prisma, "ZZZZ222222")).toBeNull();
    expect(await getPublicCertificate(prisma, "../../etc")).toBeNull();
    expect((await jsonRoute.GET(new Request(`${PUBLIC_URL}/c/ZZZZ222222/credencial.json`), params("ZZZZ222222"))).status).toBe(404);
  });

  describe("verificación subiendo el JSON", () => {
    async function verify(body: string) {
      const response = await verifyRoute.POST(
        new Request(`${PUBLIC_URL}/api/verificar`, { method: "POST", body, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } }),
      );
      return { status: response.status, body: (await response.json()) as { report?: { verified: boolean; checks: Record<"signature" | "issuer" | "validity" | "status", { outcome: string }> }; page?: string | null; error?: string } };
    }

    it("una credencial auténtica verifica y enlaza a su página", async () => {
      const certificate = await issue();
      const { credential } = await certs.getCertificate(prisma, certificate.id);
      const { body } = await verify(JSON.stringify(credential));
      expect(body.report?.verified).toBe(true);
      expect(body.page).toBe(`${PUBLIC_URL}/c/${certificate.code}`);
    });

    it("una credencial modificada falla en la firma", async () => {
      const certificate = await issue();
      const { credential } = await certs.getCertificate(prisma, certificate.id);
      const tampered = JSON.stringify(credential).replace("Valencia", "Madrid");
      const { body } = await verify(tampered);
      expect(body.report?.verified).toBe(false);
      expect(body.report?.checks.signature.outcome).toBe("failed");
      expect(body.page).toBeNull();
    });

    it("una revocada falla en la revocación; una oculta verifica pero no enlaza a la página", async () => {
      const a = await issue();
      const { credential } = await certs.getCertificate(prisma, a.id);
      await certs.setCertificateHidden(prisma, a.id, { hidden: true, reason: "Petición", actorEmail: ADMIN });
      const hidden = await verify(JSON.stringify(credential));
      expect(hidden.body.report?.verified).toBe(true);
      expect(hidden.body.page).toBeNull();
      await certs.revokeCertificate(ctx, a.id, "Error");
      const revoked = await verify(JSON.stringify(credential));
      expect(revoked.body.report?.checks.status.outcome).toBe("failed");
    });

    it("rechaza lo que no es JSON o es demasiado grande", async () => {
      expect((await verify("no es json")).status).toBe(422);
      expect((await verify(JSON.stringify({ x: "a".repeat(70_000) }))).status).toBe(413);
      const { body } = await verify(JSON.stringify({ hola: 1 }));
      expect(body.report?.checks.signature.outcome).toBe("failed");
    });
  });
});
