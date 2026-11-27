import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Cliente de Prisma único por proceso (también entre recargas de `next dev`). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta DATABASE_URL.");
    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 3_000 }),
    });
  }
  return globalForPrisma.prisma;
}

/** `true` si la base de datos responde a un `SELECT 1` en el tiempo dado. */
export async function isDatabaseReachable(timeoutMs = 3_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    await Promise.race([getPrisma().$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
