/**
 * Plantillas en la base de datos. Las versiones son de solo añadir: cambiar
 * el diseño crea una versión nueva, y una versión usada en certificados ya no
 * cambia nada (triggers en la base de datos, migración `plantillas`).
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { TemplateError } from "./errors";
import { validateFieldConfig, type FieldConfig } from "./fields";
import type { TemplateFontFile } from "./fonts";
import type { PreparedTemplate, TemplateReport } from "./prepare";
import type { Orientation } from "./sanitize";

type Db = PrismaClient | Prisma.TransactionClient;

export const MAX_TEMPLATE_NAME = 120;

export class TemplateNotFoundError extends Error {
  constructor() {
    super("Plantilla no encontrada.");
    this.name = "TemplateNotFoundError";
  }
}

export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  templateName: string;
  version: number;
  svg: string;
  svgSha256: string;
  orientation: Orientation;
  fields: FieldConfig[];
  report: TemplateReport;
  createdAt: Date;
  createdBy: string;
  lockedAt: Date | null;
  fonts: (TemplateFontFile & { id: string; fileName: string; sha256: string })[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  createdAt: Date;
  versions: { id: string; version: number; createdAt: Date; createdBy: string; lockedAt: Date | null; fieldCount: number }[];
}

function cleanName(name: string): string {
  const clean = name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!clean) throw new TemplateError("La plantilla necesita un nombre.");
  if (clean.length > MAX_TEMPLATE_NAME) throw new TemplateError(`El nombre tiene más de ${MAX_TEMPLATE_NAME} caracteres.`);
  return clean;
}

/** Los triggers de inmutabilidad hablan con mensajes que empiezan por «popicert:». */
function asTemplateError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const match = /popicert: ([^\n"]+)/.exec(message);
  if (match) throw new TemplateError(match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1) + ".");
  throw error;
}

function versionData(prepared: PreparedTemplate, actorEmail: string) {
  return {
    svg: prepared.svg,
    svgSha256: prepared.svgSha256,
    orientation: prepared.orientation,
    fields: prepared.fields as unknown as Prisma.InputJsonValue,
    report: prepared.report as unknown as Prisma.InputJsonValue,
    createdBy: actorEmail,
    fonts: {
      create: prepared.fonts.map((f) => ({
        fileName: f.fileName,
        family: f.family,
        bold: f.bold,
        italic: f.italic,
        data: new Uint8Array(f.data),
        sha256: f.sha256,
      })),
    },
  };
}

async function audit(db: Db, actorEmail: string, action: string, targetId: string, details: Record<string, unknown>) {
  await db.auditLog.create({
    data: { actorEmail, action, targetType: "template_version", targetId, details: details as Prisma.InputJsonValue },
  });
}

export async function createTemplate(
  prisma: PrismaClient,
  input: { name: string; prepared: PreparedTemplate; actorEmail: string },
): Promise<{ templateId: string; versionId: string }> {
  const name = cleanName(input.name);
  return prisma.$transaction(async (tx) => {
    const template = await tx.template.create({
      data: { name, createdBy: input.actorEmail, versions: { create: { version: 1, ...versionData(input.prepared, input.actorEmail) } } },
      include: { versions: { select: { id: true } } },
    });
    const versionId = template.versions[0]!.id;
    await audit(tx, input.actorEmail, "template.create", versionId, { templateId: template.id, name, version: 1, svgSha256: input.prepared.svgSha256 });
    return { templateId: template.id, versionId };
  });
}

export async function createTemplateVersion(
  prisma: PrismaClient,
  input: { templateId: string; prepared: PreparedTemplate; actorEmail: string },
): Promise<{ versionId: string; version: number }> {
  return prisma.$transaction(async (tx) => {
    // Bloquea la plantilla para que dos subidas a la vez no se peleen por el número de versión.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "template" WHERE id = ${input.templateId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new TemplateNotFoundError();
    const last = await tx.templateVersion.findFirst({
      where: { templateId: input.templateId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const created = await tx.templateVersion.create({
      data: { templateId: input.templateId, version, ...versionData(input.prepared, input.actorEmail) },
      select: { id: true },
    });
    await audit(tx, input.actorEmail, "template.version.create", created.id, {
      templateId: input.templateId,
      version,
      svgSha256: input.prepared.svgSha256,
    });
    return { versionId: created.id, version };
  });
}

export async function updateTemplateFields(
  prisma: PrismaClient,
  input: { versionId: string; fields: unknown; actorEmail: string },
): Promise<FieldConfig[]> {
  return prisma
    .$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ fields: FieldConfig[]; locked_at: Date | null }[]>`
        SELECT fields, locked_at FROM "template_version" WHERE id = ${input.versionId}::uuid FOR UPDATE`;
      const current = rows[0];
      if (!current) throw new TemplateNotFoundError();
      if (current.locked_at) {
        throw new TemplateError("Esta versión ya se ha usado en certificados emitidos: sube una versión nueva para cambiarla.");
      }
      const fields = validateFieldConfig(
        current.fields.map((f) => f.key),
        input.fields,
      );
      await tx.templateVersion.update({ where: { id: input.versionId }, data: { fields: fields as unknown as Prisma.InputJsonValue } });
      await audit(tx, input.actorEmail, "template.fields.update", input.versionId, { fields });
      return fields;
    })
    .catch(asTemplateError);
}

/**
 * Marca la versión como usada. Lo llama la emisión (KAN-11) dentro de su
 * transacción, antes de crear el primer certificado con ella.
 */
export async function lockTemplateVersion(db: Db, versionId: string, now = new Date()): Promise<void> {
  await db.templateVersion.updateMany({ where: { id: versionId, lockedAt: null }, data: { lockedAt: now } });
}

export async function getTemplateVersion(prisma: Db, versionId: string): Promise<TemplateVersionRecord> {
  const row = await prisma.templateVersion.findUnique({
    where: { id: versionId },
    include: { fonts: true, template: { select: { name: true } } },
  });
  if (!row) throw new TemplateNotFoundError();
  return {
    id: row.id,
    templateId: row.templateId,
    templateName: row.template.name,
    version: row.version,
    svg: row.svg,
    svgSha256: row.svgSha256,
    orientation: row.orientation as Orientation,
    fields: row.fields as unknown as FieldConfig[],
    report: row.report as unknown as TemplateReport,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    lockedAt: row.lockedAt,
    fonts: row.fonts.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      family: f.family,
      bold: f.bold,
      italic: f.italic,
      sha256: f.sha256,
      data: Buffer.from(f.data),
    })),
  };
}

export async function getLatestVersionFields(prisma: Db, templateId: string): Promise<FieldConfig[]> {
  const last = await prisma.templateVersion.findFirst({
    where: { templateId },
    orderBy: { version: "desc" },
    select: { fields: true },
  });
  if (!last) throw new TemplateNotFoundError();
  return last.fields as unknown as FieldConfig[];
}

export async function listTemplates(prisma: Db): Promise<TemplateSummary[]> {
  const templates = await prisma.template.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, createdAt: true, createdBy: true, lockedAt: true, fields: true },
      },
    },
  });
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    versions: t.versions.map(({ fields, ...v }) => ({ ...v, fieldCount: (fields as unknown[]).length })),
  }));
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
