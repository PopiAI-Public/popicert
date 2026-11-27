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

  /** Equipo de Cloudflare Access: `popiai` o `popiai.cloudflareaccess.com`. */
  CF_ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
  /** Audiencia (AUD) de la aplicación de Access que protege el admin. */
  CF_ACCESS_AUD: z.string().min(1).optional(),
  /** Emails que pueden usar el admin, separados por comas. */
  ADMIN_EMAILS: z
    .string()
    .default("info@popiai.es")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  /**
   * Solo en `next dev`: entra en el admin como este email sin Cloudflare
   * Access. Se ignora en cualquier otro entorno.
   */
  DEV_ADMIN_EMAIL: z.string().optional(),
}).superRefine((config, ctx) => {
  // Si el admin compartiera host con la web pública, quedaría expuesto en ella.
  if (config.ADMIN_HOST && config.ADMIN_HOST.trim().toLowerCase() === new URL(config.PUBLIC_URL).host.toLowerCase()) {
    ctx.addIssue({ code: "custom", path: ["ADMIN_HOST"], message: "no puede ser el mismo host que PUBLIC_URL" });
  }
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
