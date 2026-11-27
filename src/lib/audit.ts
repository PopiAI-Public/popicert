import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Registro de auditoría: quién (el email de Cloudflare Access), qué y cuándo.
 * Se escribe dentro de la misma transacción que la acción, así que no hay
 * acciones sin registro ni registros de acciones que no ocurrieron.
 */
export async function audit(
  db: Db,
  entry: { actorEmail: string; action: string; targetType: string; targetId: string; details?: Record<string, unknown> },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorEmail: entry.actorEmail,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: (entry.details ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export interface AuditEntry {
  id: string;
  createdAt: Date;
  actorEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
}

export async function listAuditLog(db: Db, options: { take?: number; targetId?: string } = {}): Promise<AuditEntry[]> {
  return db.auditLog.findMany({
    where: options.targetId ? { targetId: options.targetId } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(options.take ?? 200, 1000),
  });
}
