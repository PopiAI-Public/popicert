import { z } from "zod";

/**
 * Configuración de PopiCert. Todo llega por variables de entorno
 * (ver .env.example). Se lee bajo demanda para que `next build` no la necesite.
 */
const schema = z.object({
  /** URL pública definitiva, sin barra final. Va grabada en cada credencial y en cada QR. */
  PUBLIC_URL: z
    .url()
    .transform((value) => value.replace(/\/+$/, "")),
  /** Host del panel de administración (tras Cloudflare Access). */
  ADMIN_HOST: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),

  /** Semilla Ed25519 de la clave de firma activa, en base64url. Secreto. */
  POPICERT_SIGNING_KEY: z.string().min(1).optional(),
  /** Claves públicas retiradas (multibase z6Mk…), separadas por comas. No son secretas. */
  POPICERT_RETIRED_PUBLIC_KEYS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),

  ISSUER_NAME: z.string().min(1).default("PopiAI"),
  ISSUER_URL: z.url().default("https://popiai.es"),
  ISSUER_EMAIL: z.email().default("info@popiai.es"),

  CF_ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
  CF_ACCESS_AUD: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new Error(`Configuración no válida: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Solo para tests. */
export function resetConfigCache(): void {
  cached = undefined;
}
