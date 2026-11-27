// Tests contra una PostgreSQL real con las migraciones aplicadas.
// En local: `docker compose up -d db` y DATABASE_URL en .env. En la CI siempre se ejecutan.
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("En la CI los tests de integración necesitan DATABASE_URL.");
}

describe.skipIf(!url)("base de datos", async () => {
  const { getPrisma, isDatabaseReachable } = await import("@/lib/db");

  afterAll(async () => {
    await getPrisma().$disconnect();
  });

  it("es accesible", async () => {
    expect(await isDatabaseReachable()).toBe(true);
  });

  it("tiene las migraciones aplicadas (registro de auditoría)", async () => {
    const prisma = getPrisma();
    const entry = await prisma.auditLog.create({
      data: { actorEmail: "test@popiai.es", action: "test.integration", details: { ok: true } },
    });
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    await prisma.auditLog.delete({ where: { id: entry.id } });
  });
});
