/**
 * Formaciones: el `Achievement` de Open Badges, con su plantilla de diploma y
 * los valores de los campos de formación (fechas, lugar, ponente…).
 *
 * Lo que se cambie de una formación solo afecta a los certificados que se
 * emitan después: cada certificado guarda su credencial firmada y una copia de
 * los valores con los que se generó su PDF.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { normalizeFieldValue, MAX_VALUE_LENGTH, type FieldConfig } from "@/lib/templates/fields";
import { getTemplateVersion, isUuid, TemplateNotFoundError, type TemplateVersionRecord } from "@/lib/templates/repository";
import { IssuanceError, NotFoundError } from "./errors";

type Db = PrismaClient | Prisma.TransactionClient;

export const MAX_BADGE_BYTES = 1024 * 1024;

/** El campo del nombre del asistente: toda plantilla de una formación tiene que tenerlo. */
export const NAME_FIELD = "nombre";

/**
 * Campos de formación que, si se dejan vacíos, se rellenan con los datos de la
 * propia formación: así no hay que escribir el nombre y las horas dos veces.
 */
const DERIVED_TRAINING_FIELDS = {
  formacion: (a: { name: string }) => a.name,
  horas: (a: { hours: number | null }) => (a.hours === null ? "" : String(a.hours)),
} as const;

const text = (max: number, label: string) =>
  z
    .string({ error: `Falta ${label}.` })
    .transform((v) => v.normalize("NFC").trim())
    .pipe(z.string().min(1, `Falta ${label}.`).max(max, `${label.charAt(0).toUpperCase() + label.slice(1)} tiene más de ${max} caracteres.`));

export const achievementInputSchema = z.object({
  name: text(200, "el nombre"),
  description: text(2000, "la descripción"),
  criteria: text(2000, "los criterios"),
  hours: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (!Number.isInteger(n) || n < 1 || n > 10_000) {
        ctx.addIssue({ code: "custom", message: "Las horas tienen que ser un número entero entre 1 y 10.000." });
        return z.NEVER;
      }
      return n;
    }),
  templateVersionId: z.string({ error: "Elige una plantilla." }).refine(isUuid, "Elige una plantilla."),
  trainingValues: z.record(z.string(), z.unknown()).optional().default({}),
});
export type AchievementInput = z.input<typeof achievementInputSchema>;

export interface AchievementRecord {
  id: string;
  name: string;
  description: string;
  criteria: string;
  hours: number | null;
  badgeSha256: string | null;
  badgeMimeType: string | null;
  templateVersionId: string;
  trainingValues: Record<string, string>;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  archivedAt: Date | null;
  issuedCount: number;
}

export interface AchievementWithTemplate extends AchievementRecord {
  templateVersion: TemplateVersionRecord;
}

export function parseAchievementInput(input: unknown): z.output<typeof achievementInputSchema> {
  const parsed = achievementInputSchema.safeParse(input);
  if (!parsed.success) throw new IssuanceError(parsed.error.issues.map((i) => i.message).join(" "));
  return parsed.data;
}

export const trainingFields = (fields: readonly FieldConfig[]) => fields.filter((f) => f.scope === "training");
export const attendeeFields = (fields: readonly FieldConfig[]) => fields.filter((f) => f.scope === "attendee");

/** La plantilla sirve para emitir si el nombre del asistente es un campo obligatorio del asistente. */
export function checkTemplateUsable(version: Pick<TemplateVersionRecord, "fields" | "templateName" | "version">): void {
  const name = version.fields.find((f) => f.key === NAME_FIELD);
  if (!name || name.scope !== "attendee" || !name.required) {
    throw new IssuanceError(
      `La plantilla «${version.templateName}» (versión ${version.version}) necesita el campo {{${NAME_FIELD}}}, del asistente y obligatorio: es el nombre que va en el certificado.`,
    );
  }
}

/**
 * Limpia los valores de los campos de formación: solo los de la plantilla, y
 * los obligatorios rellenos (salvo los que salen de la propia formación).
 */
export function cleanTrainingValues(
  fields: readonly FieldConfig[],
  values: Readonly<Record<string, unknown>>,
  achievement: { name: string; hours: number | null },
): Record<string, string> {
  const clean: Record<string, string> = {};
  const problems: string[] = [];
  const derived = effectiveTrainingValues({ ...achievement, trainingValues: {} });
  for (const field of trainingFields(fields)) {
    const value = normalizeFieldValue(values[field.key]);
    if (value.length > MAX_VALUE_LENGTH) problems.push(`«${field.label}» tiene más de ${MAX_VALUE_LENGTH} caracteres`);
    if (field.required && !value && !derived[field.key]) {
      problems.push(field.key === "horas" ? `faltan «${field.label}» (o las horas de la formación)` : `falta «${field.label}»`);
    }
    if (value) clean[field.key] = value;
  }
  if (problems.length) throw new IssuanceError(`Datos de la formación incompletos: ${problems.join("; ")}.`);
  return clean;
}

/** Valores de formación con los que se rellena el diploma: los guardados más los que salen de la formación. */
export function effectiveTrainingValues(achievement: {
  name: string;
  hours: number | null;
  trainingValues: Readonly<Record<string, string>>;
}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, derive] of Object.entries(DERIVED_TRAINING_FIELDS)) {
    const value = derive(achievement as { name: string; hours: number | null });
    if (value) values[key] = value;
  }
  for (const [key, value] of Object.entries(achievement.trainingValues)) if (value) values[key] = value;
  return values;
}

/** URL pública de la imagen de la insignia. Lleva el sha256: la imagen de esa URL no cambia nunca. */
export function badgeUrl(publicUrl: string, sha256: string, mimeType: string): string {
  return `${publicUrl}/insignias/${sha256}.${mimeType === "image/jpeg" ? "jpg" : "png"}`;
}

const achievementInclude = {
  badge: { select: { mimeType: true } },
  _count: { select: { issued: true } },
} satisfies Prisma.AchievementInclude;

type AchievementRow = Prisma.AchievementGetPayload<{ include: typeof achievementInclude }>;

function toRecord(row: AchievementRow): AchievementRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    criteria: row.criteria,
    hours: row.hours,
    badgeSha256: row.badgeSha256,
    badgeMimeType: row.badge?.mimeType ?? null,
    templateVersionId: row.templateVersionId,
    trainingValues: row.trainingValues as Record<string, string>,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    issuedCount: row._count.issued,
  };
}

async function loadTemplate(db: Db, versionId: string): Promise<TemplateVersionRecord> {
  try {
    return await getTemplateVersion(db, versionId);
  } catch (error) {
    if (error instanceof TemplateNotFoundError) throw new IssuanceError("La plantilla elegida no existe.");
    throw error;
  }
}

export async function listAchievements(db: Db, options: { includeArchived?: boolean } = {}): Promise<AchievementRecord[]> {
  const rows = await db.achievement.findMany({
    where: options.includeArchived ? undefined : { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: achievementInclude,
  });
  return rows.map(toRecord);
}

export async function getAchievement(db: Db, id: string): Promise<AchievementWithTemplate> {
  if (!isUuid(id)) throw new NotFoundError("formación");
  const row = await db.achievement.findUnique({ where: { id }, include: achievementInclude });
  if (!row) throw new NotFoundError("formación");
  return { ...toRecord(row), templateVersion: await getTemplateVersion(db, row.templateVersionId) };
}

export async function createAchievement(prisma: PrismaClient, input: unknown, actorEmail: string): Promise<AchievementRecord> {
  const data = parseAchievementInput(input);
  const version = await loadTemplate(prisma, data.templateVersionId);
  checkTemplateUsable(version);
  const trainingValues = cleanTrainingValues(version.fields, data.trainingValues, data);

  return prisma.$transaction(async (tx) => {
    const row = await tx.achievement.create({
      data: {
        name: data.name,
        description: data.description,
        criteria: data.criteria,
        hours: data.hours,
        templateVersionId: data.templateVersionId,
        trainingValues,
        createdBy: actorEmail,
      },
      include: achievementInclude,
    });
    await audit(tx, {
      actorEmail,
      action: "achievement.create",
      targetType: "achievement",
      targetId: row.id,
      details: { name: row.name, hours: row.hours, templateVersionId: row.templateVersionId, trainingValues },
    });
    return toRecord(row);
  });
}

export async function updateAchievement(prisma: PrismaClient, id: string, input: unknown, actorEmail: string): Promise<AchievementRecord> {
  if (!isUuid(id)) throw new NotFoundError("formación");
  const data = parseAchievementInput(input);
  const version = await loadTemplate(prisma, data.templateVersionId);
  checkTemplateUsable(version);
  const trainingValues = cleanTrainingValues(version.fields, data.trainingValues, data);

  return prisma.$transaction(async (tx) => {
    const current = await tx.achievement.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("formación");
    if (current.archivedAt) throw new IssuanceError("La formación está archivada: recupérala para editarla.");
    const row = await tx.achievement.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        criteria: data.criteria,
        hours: data.hours,
        templateVersionId: data.templateVersionId,
        trainingValues,
      },
      include: achievementInclude,
    });
    await audit(tx, {
      actorEmail,
      action: "achievement.update",
      targetType: "achievement",
      targetId: id,
      details: {
        before: { name: current.name, description: current.description, criteria: current.criteria, hours: current.hours, templateVersionId: current.templateVersionId, trainingValues: current.trainingValues },
        after: { name: row.name, description: row.description, criteria: row.criteria, hours: row.hours, templateVersionId: row.templateVersionId, trainingValues },
      },
    });
    return toRecord(row);
  });
}

export async function setAchievementArchived(prisma: PrismaClient, id: string, archived: boolean, actorEmail: string): Promise<AchievementRecord> {
  if (!isUuid(id)) throw new NotFoundError("formación");
  return prisma.$transaction(async (tx) => {
    const current = await tx.achievement.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("formación");
    const row = await tx.achievement.update({
      where: { id },
      data: { archivedAt: archived ? (current.archivedAt ?? new Date()) : null },
      include: achievementInclude,
    });
    if (Boolean(current.archivedAt) !== archived) {
      await audit(tx, { actorEmail, action: archived ? "achievement.archive" : "achievement.unarchive", targetType: "achievement", targetId: id });
    }
    return toRecord(row);
  });
}

/** Solo se borra una formación sin certificados. Con certificados, se archiva. */
export async function deleteAchievement(prisma: PrismaClient, id: string, actorEmail: string): Promise<void> {
  if (!isUuid(id)) throw new NotFoundError("formación");
  await prisma.$transaction(async (tx) => {
    // Bloquea la formación: una emisión simultánea espera y después no la encuentra.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "achievement" WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("formación");
    const issued = await tx.credential.count({ where: { achievementId: id } });
    if (issued > 0) {
      throw new IssuanceError(`La formación tiene ${issued} certificado${issued === 1 ? "" : "s"} emitido${issued === 1 ? "" : "s"}: no se puede borrar, solo archivar.`);
    }
    const row = await tx.achievement.delete({ where: { id } });
    await audit(tx, { actorEmail, action: "achievement.delete", targetType: "achievement", targetId: id, details: { name: row.name } });
  });
}

/** Detecta PNG o JPEG por los primeros bytes, sin fiarse de la extensión ni del tipo que manda el navegador. */
export function detectImageType(data: Buffer): "image/png" | "image/jpeg" | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

/** Cambia la imagen de la insignia. Las imágenes anteriores se quedan: las enlazan los certificados ya emitidos. */
export async function setAchievementBadge(prisma: PrismaClient, id: string, data: Buffer, actorEmail: string): Promise<AchievementRecord> {
  if (!isUuid(id)) throw new NotFoundError("formación");
  if (data.length === 0) throw new IssuanceError("Falta la imagen.");
  if (data.length > MAX_BADGE_BYTES) throw new IssuanceError(`La imagen ocupa más de ${MAX_BADGE_BYTES / 1024 / 1024} MB.`);
  const mimeType = detectImageType(data);
  if (!mimeType) throw new IssuanceError("La imagen tiene que ser PNG o JPEG.");
  const sha256 = createHash("sha256").update(data).digest("hex");

  return prisma.$transaction(async (tx) => {
    const current = await tx.achievement.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("formación");
    if (current.archivedAt) throw new IssuanceError("La formación está archivada: recupérala para editarla.");
    await tx.badgeImage.createMany({ data: [{ sha256, mimeType, data: new Uint8Array(data) }], skipDuplicates: true });
    const row = await tx.achievement.update({ where: { id }, data: { badgeSha256: sha256 }, include: achievementInclude });
    await audit(tx, { actorEmail, action: "achievement.badge", targetType: "achievement", targetId: id, details: { sha256, mimeType, bytes: data.length } });
    return toRecord(row);
  });
}

export interface TemplateChoice {
  versionId: string;
  label: string;
  fields: FieldConfig[];
  /** `null` si sirve para emitir; si no, por qué no. */
  problem: string | null;
}

/** Versiones de plantilla para elegir en el formulario de la formación, la más reciente de cada plantilla primero. */
export async function listTemplateChoices(db: Db): Promise<TemplateChoice[]> {
  const versions = await db.templateVersion.findMany({
    orderBy: [{ template: { createdAt: "desc" } }, { version: "desc" }],
    select: { id: true, version: true, fields: true, template: { select: { name: true } } },
  });
  return versions.map((v) => {
    const fields = v.fields as unknown as FieldConfig[];
    let problem: string | null = null;
    try {
      checkTemplateUsable({ fields, templateName: v.template.name, version: v.version });
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    return { versionId: v.id, label: `${v.template.name} · versión ${v.version}`, fields, problem };
  });
}

export async function getBadgeImage(db: Db, sha256: string): Promise<{ mimeType: string; data: Buffer } | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const row = await db.badgeImage.findUnique({ where: { sha256 } });
  return row ? { mimeType: row.mimeType, data: Buffer.from(row.data) } : null;
}
