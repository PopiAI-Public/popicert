// Formaciones y emisión de certificados contra una PostgreSQL real (KAN-11).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IssuerContext } from "@/lib/ob/issuer";
import { testIssuerContext, TEST_PUBLIC_URL } from "@/lib/ob/testing";
import { verifyCredential } from "@/lib/ob/verify";
import { createStatusChecker } from "@/lib/status/status-list";
import { exampleFonts, exampleSvg, hasPoppler, decodeQrFromPdf, pdfText } from "@/lib/templates/testing";

const url = process.env.DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("En la CI los tests de integración necesitan DATABASE_URL.");
}

const ADMIN = "info@popiai.es";

describe.skipIf(!url)("formaciones y emisión de certificados", async () => {
  const { getPrisma } = await import("@/lib/db");
  const { prepareTemplate } = await import("@/lib/templates/prepare");
  const { createTemplate, createTemplateVersion, getTemplateVersion, updateTemplateFields } = await import("@/lib/templates/repository");
  const achievements = await import("@/lib/issuance/achievements");
  const certs = await import("@/lib/issuance/certificates");
  const { IssuanceError } = await import("@/lib/issuance/errors");
  const { createStatusAwareDocumentLoader } = await import("@/lib/status/repository");
  const { listAuditLog } = await import("@/lib/audit");
  const prisma = getPrisma();
  let issuer: IssuerContext;

  const reset = () =>
    prisma.$executeRawUnsafe(
      "TRUNCATE credential, achievement, badge_image, status_entry, status_list, template_font, template_version, template, audit_log RESTART IDENTITY CASCADE",
    );

  beforeAll(async () => {
    issuer = await testIssuerContext();
  });
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  async function template() {
    const prepared = await prepareTemplate({ svg: exampleSvg(), fonts: await exampleFonts(), publicUrl: TEST_PUBLIC_URL });
    return createTemplate(prisma, { name: "Diploma estándar", prepared, actorEmail: ADMIN });
  }

  async function training(overrides: Record<string, unknown> = {}) {
    const { versionId } = await template();
    return achievements.createAchievement(
      prisma,
      {
        name: "IA generativa para pymes",
        description: "Formación presencial sobre IA generativa aplicada al trabajo diario.",
        criteria: "Asistir a la formación completa.",
        hours: 8,
        templateVersionId: versionId,
        trainingValues: { fecha: "27 de noviembre de 2026", lugar: "Valencia", ponente: "Ana Peña" },
        ...overrides,
      },
      ADMIN,
    );
  }

  const ctx = () => ({ prisma, issuer, actorEmail: ADMIN });

  function verify(credential: unknown) {
    const loader = createStatusAwareDocumentLoader(prisma, issuer);
    return verifyCredential({ credential, documentLoader: loader, expectedIssuer: issuer.did, checkStatus: createStatusChecker(loader) });
  }

  describe("formaciones", () => {
    it("crea una formación y rellena «formacion» y «horas» con sus datos", async () => {
      const created = await training();
      const full = await achievements.getAchievement(prisma, created.id);
      expect(full.trainingValues).toEqual({ fecha: "27 de noviembre de 2026", lugar: "Valencia", ponente: "Ana Peña" });
      expect(achievements.effectiveTrainingValues(full)).toMatchObject({ formacion: "IA generativa para pymes", horas: "8" });
      const log = await listAuditLog(prisma, { targetId: created.id });
      expect(log.map((e) => e.action)).toEqual(["achievement.create"]);
    });

    it("pide los campos obligatorios de la formación", async () => {
      await expect(training({ trainingValues: { lugar: "Valencia" } })).rejects.toThrow(/falta «Fecha»/);
      await expect(training({ hours: null, trainingValues: { fecha: "hoy" } })).rejects.toThrow(/«Horas»/);
      await expect(training({ name: "  " })).rejects.toThrow(/Falta el nombre/);
      await expect(training({ hours: 2.5 })).rejects.toThrow(/número entero/);
    });

    it("no acepta una plantilla sin el nombre del asistente", async () => {
      const { versionId } = await template();
      const version = await getTemplateVersion(prisma, versionId);
      await updateTemplateFields(prisma, {
        versionId,
        fields: version.fields.map((f) => (f.key === "nombre" ? { ...f, scope: "training" } : f)),
        actorEmail: ADMIN,
      });
      await expect(
        achievements.createAchievement(
          prisma,
          { name: "X", description: "X", criteria: "X", hours: 1, templateVersionId: versionId, trainingValues: { fecha: "hoy", nombre: "Todos" } },
          ADMIN,
        ),
      ).rejects.toThrow(/necesita el campo \{\{nombre\}\}/);
    });

    it("una formación con certificados no se borra, solo se archiva; archivada no emite", async () => {
      const created = await training();
      await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      await expect(achievements.deleteAchievement(prisma, created.id, ADMIN)).rejects.toThrow(/solo archivar/);
      await achievements.setAchievementArchived(prisma, created.id, true, ADMIN);
      await expect(certs.issueCertificate(ctx(), created.id, { values: { nombre: "Otro" } })).rejects.toThrow(/archivada/);
      // Ni siquiera saltándose la aplicación: la base de datos no deja borrarla.
      await expect(prisma.achievement.delete({ where: { id: created.id } })).rejects.toThrow();

      const empty = await training();
      await achievements.deleteAchievement(prisma, empty.id, ADMIN);
      expect(await prisma.achievement.count({ where: { id: empty.id } })).toBe(0);
    });

    it("la insignia solo admite PNG o JPEG, y su URL lleva el sha256", async () => {
      const created = await training();
      await expect(achievements.setAchievementBadge(prisma, created.id, Buffer.from("<svg/>"), ADMIN)).rejects.toThrow(/PNG o JPEG/);
      const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
      const updated = await achievements.setAchievementBadge(prisma, created.id, png, ADMIN);
      expect(updated.badgeSha256).toMatch(/^[0-9a-f]{64}$/);
      const { certificate } = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      const detail = await certs.getCertificate(prisma, certificate.id);
      const achievement = (detail.credential.credentialSubject as { achievement: { image: { id: string } } }).achievement;
      expect(achievement.image.id).toBe(`${TEST_PUBLIC_URL}/insignias/${updated.badgeSha256}.png`);
      expect((await achievements.getBadgeImage(prisma, updated.badgeSha256!))?.data.equals(png)).toBe(true);
    });
  });

  describe("emisión individual", () => {
    it("emite una credencial firmada que verifica, con el email solo con hash", async () => {
      const created = await training();
      const outcome = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "  María  José Núñez " }, email: "Maria@Example.com" });
      expect(outcome.status).toBe("issued");
      expect(outcome.certificate.code).toMatch(/^[23456789A-HJKMNP-Z]{10}$/);
      expect(outcome.certificate.url).toBe(`${TEST_PUBLIC_URL}/c/${outcome.certificate.code}`);
      expect(outcome.certificate.recipientName).toBe("María José Núñez");

      const detail = await certs.getCertificate(prisma, outcome.certificate.id);
      expect(JSON.stringify(detail.credential)).not.toContain("maria@example.com");
      expect(detail.recipientEmail).toBe("maria@example.com");
      expect(detail.credential.validFrom).toBe(detail.issuedAt.toISOString().replace(".000Z", "Z"));

      const report = await verify(detail.credential);
      expect(report.verified).toBe(true);

      // La versión de la plantilla queda bloqueada: ya no cambia.
      const version = await getTemplateVersion(prisma, detail.templateVersionId);
      expect(version.lockedAt).not.toBeNull();
      const log = await listAuditLog(prisma, { targetId: outcome.certificate.id });
      expect(log).toMatchObject([{ action: "certificate.issue", actorEmail: ADMIN }]);
    });

    it("no emite dos veces al mismo asistente, aunque lo escriban distinto", async () => {
      const created = await training();
      const first = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "José Pérez" } });
      const again = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "JOSE  perez" } });
      expect(again).toMatchObject({ status: "existing", certificate: { id: first.certificate.id } });
      expect(await prisma.credential.count()).toBe(1);
      // La posición de la lista que se reservó de más no se queda colgando.
      expect(await prisma.statusEntry.count()).toBe(1);
    });

    it("dos emisiones simultáneas del mismo asistente dan un solo certificado", async () => {
      const created = await training();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } })),
      );
      expect(new Set(results.map((r) => r.certificate.id)).size).toBe(1);
      expect(results.filter((r) => r.status === "issued")).toHaveLength(1);
      expect(await prisma.credential.count()).toBe(1);
      expect(await prisma.statusEntry.count()).toBe(1);
    });

    it("rechaza datos que no caben en la plantilla, sin emitir nada", async () => {
      const created = await training();
      await expect(certs.issueCertificate(ctx(), created.id, { values: { nombre: "" } })).rejects.toThrow(/falta «Nombre»/);
      await expect(certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana" }, email: "no-es-un-email" })).rejects.toThrow(/no es válido/);
      await expect(certs.issueCertificate(ctx(), created.id, { values: { nombre: "Иван Петров" } })).rejects.toThrow(/Faltan caracteres/);
      expect(await prisma.credential.count()).toBe(0);
      expect(await prisma.statusEntry.count()).toBe(0);
    });

    it("genera el PDF con el QR a la URL del certificado y la credencial adjunta", async () => {
      const created = await training();
      const { certificate } = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "María José Fernández-Castañeda Núñez" } });
      const detail = await certs.getCertificate(prisma, certificate.id);
      const pdf = await certs.renderCertificatePdf(prisma, detail, "PopiAI");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.includes(Buffer.from(`certificado-${certificate.code}.json`))).toBe(true);
      // El mismo certificado da siempre el mismo PDF.
      expect((await certs.renderCertificatePdf(prisma, detail, "PopiAI")).equals(pdf)).toBe(true);
      if (hasPoppler()) {
        expect(decodeQrFromPdf(pdf)).toBe(certificate.url);
        const text = pdfText(pdf).replace(/\s+/g, " ");
        expect(text).toContain("María José Fernández-Castañeda Núñez");
        expect(text).toContain("IA generativa para pymes");
      }
    });

    it("los cambios en la formación no tocan lo ya emitido", async () => {
      const created = await training();
      const { certificate } = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      const before = await certs.getCertificate(prisma, certificate.id);
      await achievements.updateAchievement(
        prisma,
        created.id,
        { name: "Otro nombre", description: "Otra", criteria: "Otros", hours: 4, templateVersionId: before.templateVersionId, trainingValues: { fecha: "mañana" } },
        ADMIN,
      );
      const after = await certs.getCertificate(prisma, certificate.id);
      expect(after.credential).toEqual(before.credential);
      expect(after.trainingValues).toEqual(before.trainingValues);
      expect(after.achievementName).toBe("IA generativa para pymes");
    });

    it("la base de datos no deja modificar un certificado emitido", async () => {
      const created = await training();
      const { certificate } = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      await expect(prisma.credential.update({ where: { id: certificate.id }, data: { recipientName: "Otra" } })).rejects.toThrow(/no se modifica/);
    });
  });

  describe("CSV", () => {
    const header = "nombre;email\n";

    it("emite una tanda de 30 desde un CSV y repetirlo no crea certificados nuevos", async () => {
      const created = await training();
      const names = Array.from({ length: 30 }, (_, i) => `Asistente Número ${i + 1}`);
      const csv = header + names.map((n, i) => `${n};asistente${i + 1}@example.com`).join("\n");

      const preview = await certs.previewCsv(prisma, created.id, csv);
      expect(preview.counts).toEqual({ ok: 30, existing: 0, error: 0, issued: 0 });
      expect(await prisma.credential.count()).toBe(0);

      const first = await certs.issueCsv(ctx(), created.id, csv);
      expect(first.counts).toEqual({ ok: 0, existing: 0, error: 0, issued: 30 });
      expect(new Set(first.rows.map((r) => r.certificate!.code)).size).toBe(30);

      const second = await certs.issueCsv(ctx(), created.id, csv);
      expect(second.counts).toEqual({ ok: 0, existing: 30, error: 0, issued: 0 });
      expect(second.rows.map((r) => r.certificate!.id)).toEqual(first.rows.map((r) => r.certificate!.id));
      expect(await prisma.credential.count()).toBe(30);

      const log = await listAuditLog(prisma, { targetId: created.id });
      expect(log.filter((e) => e.action === "certificate.batch")).toHaveLength(2);
    });

    it("valida fila a fila: obligatorios, repetidos dentro del CSV y ya emitidos", async () => {
      const created = await training();
      await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ya Emitida" } });
      const csv = [
        "Nombre,Correo,Otra columna",
        "Ana López,ana@example.com,x",
        ",sin-nombre@example.com,x",
        "ANA LOPEZ,otra@example.com,x",
        "Ya Emitida,,x",
        "Luis,no-es-email,x",
        "",
      ].join("\r\n");
      const preview = await certs.previewCsv(prisma, created.id, csv);
      expect(preview.ignoredColumns).toEqual(["Otra columna"]);
      expect(preview.rows.map((r) => [r.line, r.status])).toEqual([
        [2, "ok"],
        [3, "error"],
        [4, "error"],
        [5, "existing"],
        [6, "error"],
      ]);
      expect(preview.rows[1]!.messages[0]).toMatch(/falta «Nombre»/);
      expect(preview.rows[2]!.messages[0]).toMatch(/línea 2/);

      const report = await certs.issueCsv(ctx(), created.id, csv);
      expect(report.counts).toEqual({ ok: 0, existing: 1, error: 3, issued: 1 });
      expect(await prisma.credential.count()).toBe(2);
    });

    it("rechaza un CSV sin las columnas obligatorias", async () => {
      const created = await training();
      await expect(certs.previewCsv(prisma, created.id, "email\na@example.com")).rejects.toThrow(/Faltan columnas.*«nombre»/);
      await expect(certs.previewCsv(prisma, created.id, "nombre\n")).rejects.toThrow(/ninguna fila/);
    });

    it("con DNI, el duplicado es por DNI y no por nombre", async () => {
      const { versionId: v1, templateId } = await template();
      const svg = exampleSvg().replace("{{nombre}}", "{{nombre}} ({{dni}})");
      const prepared = await prepareTemplate({ svg, fonts: await exampleFonts(), publicUrl: TEST_PUBLIC_URL, previousFields: (await getTemplateVersion(prisma, v1)).fields });
      const { versionId } = await createTemplateVersion(prisma, { templateId, prepared, actorEmail: ADMIN });
      const created = await achievements.createAchievement(
        prisma,
        { name: "Con DNI", description: "X", criteria: "X", hours: 2, templateVersionId: versionId, trainingValues: { fecha: "hoy" } },
        ADMIN,
      );
      const report = await certs.issueCsv(ctx(), created.id, "nombre;dni\nAna López;12.345.678-z\nAna López;87654321X\nAna M. López;12345678Z\n");
      expect(report.rows.map((r) => r.status)).toEqual(["issued", "issued", "error"]);
      const detail = await certs.getCertificate(prisma, report.rows[0]!.certificate!.id);
      // El DNI va al PDF, pero nunca a la credencial firmada.
      expect(detail.attendeeValues.dni).toBe("12.345.678-z");
      expect(JSON.stringify(detail.credential)).not.toMatch(/12.?345.?678/);
    });
  });

  describe("revocación y ocultación", () => {
    it("revoca con motivo: la credencial deja de verificar y se puede volver a emitir", async () => {
      const created = await training();
      const { certificate } = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      await expect(certs.revokeCertificate(ctx(), certificate.id, "  ")).rejects.toThrow(/motivo/);

      const revoked = await certs.revokeCertificate(ctx(), certificate.id, "Nombre mal escrito");
      expect(revoked.alreadyRevoked).toBe(false);
      expect(revoked.certificate.revocationReason).toBe("Nombre mal escrito");
      const again = await certs.revokeCertificate(ctx(), certificate.id, "Otro motivo");
      expect(again).toMatchObject({ alreadyRevoked: true, certificate: { revocationReason: "Nombre mal escrito" } });

      const detail = await certs.getCertificate(prisma, certificate.id);
      const report = await verify(detail.credential);
      expect(report.verified).toBe(false);
      expect(report.checks.status.outcome).toBe("failed");

      // Rectificación: tras revocar, el mismo asistente puede recibir otro.
      const reissued = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      expect(reissued.status).toBe("issued");
      expect(reissued.certificate.id).not.toBe(certificate.id);

      // Y una revocación no se deshace, ni tocando la base de datos.
      await expect(prisma.credential.update({ where: { id: certificate.id }, data: { revokedAt: null } })).rejects.toThrow(/no se deshace/);
      const log = await listAuditLog(prisma, { targetId: certificate.id });
      expect(log.map((e) => e.action)).toEqual(["certificate.revoke", "certificate.issue"]);
    });

    it("oculta y vuelve a mostrar un certificado, con motivo", async () => {
      const created = await training();
      const { certificate } = await certs.issueCertificate(ctx(), created.id, { values: { nombre: "Ana López" } });
      await expect(certs.setCertificateHidden(prisma, certificate.id, { hidden: true, actorEmail: ADMIN })).rejects.toThrow(/motivo/);
      const hidden = await certs.setCertificateHidden(prisma, certificate.id, { hidden: true, reason: "Petición por email", actorEmail: ADMIN });
      expect(hidden.hiddenAt).not.toBeNull();
      const shown = await certs.setCertificateHidden(prisma, certificate.id, { hidden: false, actorEmail: ADMIN });
      expect(shown).toMatchObject({ hiddenAt: null, hiddenReason: null });
    });
  });

  describe("búsqueda y exportación", () => {
    it("busca por nombre o por código y exporta lista para pegar", async () => {
      const created = await training();
      const report = await certs.issueCsv(ctx(), created.id, "nombre\nAna López\nLuis García\n=HYPERLINK(\"x\")\n");
      const ana = report.rows[0]!.certificate!;
      expect((await certs.searchCertificates(prisma, { query: "lópez" })).map((c) => c.id)).toEqual([ana.id]);
      expect((await certs.searchCertificates(prisma, { query: ana.code.toLowerCase() })).map((c) => c.id)).toEqual([ana.id]);
      expect((await certs.searchCertificates(prisma, { query: `${ana.code.slice(0, 5)}-${ana.code.slice(5)}` })).map((c) => c.id)).toEqual([ana.id]);
      expect(await certs.searchCertificates(prisma, { achievementId: created.id })).toHaveLength(3);

      const { toCsv } = await import("@/lib/issuance/csv");
      const csv = toCsv(certs.exportRows(await certs.searchCertificates(prisma, { achievementId: created.id })));
      expect(csv.startsWith("﻿Nombre;Email;Enlace;Código;Estado;Emitido")).toBe(true);
      expect(csv).toContain(`Ana López;;${ana.url};${ana.code};Válido;`);
      // Nada de fórmulas al abrirlo en Excel.
      expect(csv).toContain(`'=HYPERLINK`);
    });
  });

  it("los errores de datos son IssuanceError, para enseñarlos en el admin", async () => {
    const created = await training();
    await expect(certs.issueCertificate(ctx(), created.id, { values: {} })).rejects.toBeInstanceOf(IssuanceError);
  });
});
