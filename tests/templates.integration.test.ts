// Plantillas y versionado contra una PostgreSQL real (KAN-13).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TemplateError } from "@/lib/templates/errors";
import { prepareTemplate, type FontUpload, type PreparedTemplate } from "@/lib/templates/prepare";
import { renderPdf } from "@/lib/templates/render";
import { EXAMPLE_DIR, EXAMPLE_FONT_FILES, EXAMPLE_VALUES, exampleSvg } from "@/lib/templates/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("En la CI los tests de integración necesitan DATABASE_URL.");
}

const PUBLIC_URL = "https://certificados.popiai.es";
const ACTOR = "info@popiai.es";
const DATE = new Date("2026-11-27T10:00:00Z");

describe.skipIf(!url)("plantillas en la base de datos", async () => {
  const { getPrisma } = await import("@/lib/db");
  const repo = await import("@/lib/templates/repository");
  const prisma = getPrisma();
  let fonts: FontUpload[];
  let prepared: PreparedTemplate;

  const reset = () => prisma.$executeRawUnsafe("TRUNCATE template_font, template_version, template, audit_log RESTART IDENTITY CASCADE");

  beforeAll(async () => {
    fonts = EXAMPLE_FONT_FILES.map((fileName) => ({ fileName, data: readFileSync(join(EXAMPLE_DIR, "fuentes", fileName)) }));
    prepared = await prepareTemplate({ svg: exampleSvg(), fonts, publicUrl: PUBLIC_URL });
  });
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  async function pdfOf(versionId: string) {
    const version = await repo.getTemplateVersion(prisma, versionId);
    const { pdf } = await renderPdf({
      svg: version.svg,
      fields: version.fields,
      values: EXAMPLE_VALUES,
      code: "ABCD234567",
      url: `${PUBLIC_URL}/c/ABCD234567`,
      fonts: version.fonts,
      title: "Diploma",
      author: "PopiAI",
      date: DATE,
    });
    return pdf;
  }

  it("guarda la plantilla con sus fuentes y genera desde la base de datos el mismo PDF", async () => {
    const { templateId, versionId } = await repo.createTemplate(prisma, { name: "  Diploma   PopiAI ", prepared, actorEmail: ACTOR });
    const version = await repo.getTemplateVersion(prisma, versionId);
    expect(version).toMatchObject({ templateId, templateName: "Diploma PopiAI", version: 1, orientation: "landscape", lockedAt: null });
    expect(version.fields.map((f) => f.key)).toEqual(["nombre", "formacion", "horas", "lugar", "fecha", "ponente"]);
    expect(version.fonts.map((f) => f.sha256).sort()).toEqual(prepared.fonts.map((f) => f.sha256).sort());

    const fromPrepared = await renderPdf({
      svg: prepared.svg,
      fields: prepared.fields,
      values: EXAMPLE_VALUES,
      code: "ABCD234567",
      url: `${PUBLIC_URL}/c/ABCD234567`,
      fonts: prepared.fonts,
      title: "Diploma",
      author: "PopiAI",
      date: DATE,
    });
    expect((await pdfOf(versionId)).equals(fromPrepared.pdf)).toBe(true);

    const audit = await prisma.auditLog.findMany({ where: { targetId: versionId } });
    expect(audit).toMatchObject([{ actorEmail: ACTOR, action: "template.create", targetType: "template_version" }]);
  });

  it("se puede ajustar la configuración de los campos mientras la versión no se ha usado", async () => {
    const { versionId } = await repo.createTemplate(prisma, { name: "D", prepared, actorEmail: ACTOR });
    const fields = prepared.fields.map((f) => (f.key === "lugar" ? { ...f, required: true, label: "Ciudad" } : f));
    await repo.updateTemplateFields(prisma, { versionId, fields, actorEmail: ACTOR });
    expect((await repo.getTemplateVersion(prisma, versionId)).fields.find((f) => f.key === "lugar")).toMatchObject({ label: "Ciudad", required: true });
    await expect(repo.updateTemplateFields(prisma, { versionId, fields: fields.slice(1), actorEmail: ACTOR })).rejects.toThrow(/faltan: nombre/);
  });

  it("una versión usada no cambia: ni desde la aplicación ni tocando la base de datos", async () => {
    const { versionId } = await repo.createTemplate(prisma, { name: "D", prepared, actorEmail: ACTOR });
    await repo.lockTemplateVersion(prisma, versionId);
    const before = await pdfOf(versionId);

    await expect(repo.updateTemplateFields(prisma, { versionId, fields: prepared.fields, actorEmail: ACTOR })).rejects.toThrow(TemplateError);

    const attempts = [
      `UPDATE template_version SET svg = replace(svg, 'Certificado', 'Falsificado') WHERE id = '${versionId}'`,
      `UPDATE template_version SET fields = '[]' WHERE id = '${versionId}'`,
      `UPDATE template_version SET locked_at = NULL WHERE id = '${versionId}'`,
      `DELETE FROM template_version WHERE id = '${versionId}'`,
      `UPDATE template_font SET data = '\\x00' WHERE version_id = '${versionId}'`,
      `DELETE FROM template_font WHERE version_id = '${versionId}'`,
      `INSERT INTO template_font (id, version_id, file_name, family, bold, italic, data, sha256)
         VALUES (gen_random_uuid(), '${versionId}', 'x.ttf', 'Otra', false, false, '\\x00', 'x')`,
    ];
    for (const sql of attempts) {
      await expect(prisma.$executeRawUnsafe(sql), sql).rejects.toThrow(/popicert:/);
    }
    expect((await pdfOf(versionId)).equals(before)).toBe(true);
  });

  it("el SVG de una versión no se cambia ni siquiera antes de usarla: se crea otra versión", async () => {
    const { versionId } = await repo.createTemplate(prisma, { name: "D", prepared, actorEmail: ACTOR });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE template_version SET svg = svg || ' ' WHERE id = '${versionId}'`),
    ).rejects.toThrow(/crea una versión nueva/);
    // Mientras no se ha usado, sí se puede borrar (con sus fuentes).
    await prisma.templateVersion.delete({ where: { id: versionId } });
    expect(await prisma.templateFont.count()).toBe(0);
  });

  it("cambiar la plantilla no altera el PDF de los certificados ya emitidos", async () => {
    const { templateId, versionId: v1 } = await repo.createTemplate(prisma, { name: "D", prepared, actorEmail: ACTOR });
    await repo.lockTemplateVersion(prisma, v1);
    const issued = await pdfOf(v1);

    const redesigned = await prepareTemplate({
      svg: exampleSvg().replace("Certificado de aprovechamiento", "Diploma de asistencia").replace(/#1f3b4d/g, "#7a1f1f"),
      fonts,
      publicUrl: PUBLIC_URL,
      previousFields: (await repo.getTemplateVersion(prisma, v1)).fields,
    });
    const { versionId: v2, version } = await repo.createTemplateVersion(prisma, { templateId, prepared: redesigned, actorEmail: ACTOR });
    expect(version).toBe(2);

    expect((await pdfOf(v1)).equals(issued)).toBe(true);
    expect((await pdfOf(v2)).equals(issued)).toBe(false);
  });

  it("una versión nueva hereda la configuración de los campos de la anterior", async () => {
    const { templateId, versionId } = await repo.createTemplate(prisma, { name: "D", prepared, actorEmail: ACTOR });
    const custom = prepared.fields.map((f) => (f.key === "ponente" ? { ...f, label: "Formador", public: false } : f));
    await repo.updateTemplateFields(prisma, { versionId, fields: custom, actorEmail: ACTOR });
    const next = await prepareTemplate({
      svg: exampleSvg(),
      fonts,
      publicUrl: PUBLIC_URL,
      previousFields: await repo.getLatestVersionFields(prisma, templateId),
    });
    expect(next.fields.find((f) => f.key === "ponente")).toMatchObject({ label: "Formador", public: false });
  });

  it("subidas simultáneas de versiones no repiten número", async () => {
    const { templateId } = await repo.createTemplate(prisma, { name: "D", prepared, actorEmail: ACTOR });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => repo.createTemplateVersion(prisma, { templateId, prepared, actorEmail: ACTOR })),
    );
    expect(results.map((r) => r.version).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
    const list = await repo.listTemplates(prisma);
    expect(list[0]!.versions.map((v) => v.version)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it("una plantilla que no existe da TemplateNotFoundError", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(repo.getTemplateVersion(prisma, missing)).rejects.toThrow(repo.TemplateNotFoundError);
    await expect(repo.createTemplateVersion(prisma, { templateId: missing, prepared, actorEmail: ACTOR })).rejects.toThrow(
      repo.TemplateNotFoundError,
    );
  });
});
