import { defineConfig } from "prisma/config";

// Prisma 7 no carga .env por su cuenta. En local lo leemos si existe;
// en el contenedor las variables llegan por el entorno.
try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan las variables del entorno.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `prisma generate` no necesita conexión; `migrate` falla con un error claro si falta.
    // Las migraciones pueden ir con otro usuario, dueño de las tablas
    // (MIGRATION_DATABASE_URL), y la app con uno que solo lee y escribe filas:
    // así la app no puede desactivar los triggers que protegen lo emitido.
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  },
});
