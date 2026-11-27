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
    url: process.env.DATABASE_URL,
  },
});
