import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getConfig } from "../config";

/**
 * Autenticación del admin con Cloudflare Access.
 *
 * Cloudflare Access pone delante del host de admin un login (PIN por email) y
 * añade a cada petición la cabecera `Cf-Access-Jwt-Assertion`, un JWT firmado
 * por el equipo de Access. La app **no se fía del proxy**: valida ese JWT en
 * cada petición (firma, emisor, audiencia, caducidad y email permitido). Sin
 * token válido, 403, aunque la petición llegue por la red interna.
 */

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

export interface AccessConfig {
  /** p. ej. popiai.cloudflareaccess.com */
  teamDomain: string;
  audience: string;
  allowedEmails: readonly string[];
}

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; reason: AdminAuthFailure };

export type AdminAuthFailure =
  | "missing_token"
  | "invalid_token"
  | "expired_token"
  | "email_not_allowed"
  | "access_not_configured";

export function normalizeTeamDomain(value: string): string {
  const host = value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  return host.includes(".") ? host : `${host}.cloudflareaccess.com`;
}

export type AccessVerifier = (token: string | null | undefined) => Promise<AdminAuthResult>;

/** Crea un verificador de tokens de Access. `keys` se inyecta en los tests. */
export function createAccessVerifier(config: AccessConfig, keys?: JWTVerifyGetKey): AccessVerifier {
  const teamDomain = normalizeTeamDomain(config.teamDomain);
  const issuer = `https://${teamDomain}`;
  // jose cachea las claves públicas del equipo y las renueva cuando rotan.
  const getKey = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const allowed = new Set(config.allowedEmails.map((email) => email.toLowerCase()));

  return async (token) => {
    if (!token) return { ok: false, reason: "missing_token" };
    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer,
        audience: config.audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "email"],
        clockTolerance: 30,
      });
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      if (!email || !allowed.has(email)) return { ok: false, reason: "email_not_allowed" };
      return { ok: true, email };
    } catch (error) {
      if (error instanceof errors.JWTExpired) return { ok: false, reason: "expired_token" };
      return { ok: false, reason: "invalid_token" };
    }
  };
}

let cachedVerifier: { key: string; verifier: AccessVerifier } | undefined;

/** Verificador a partir de la configuración del entorno, o `null` si falta. */
function getAccessVerifier(): AccessVerifier | null {
  const config = getConfig();
  if (!config.CF_ACCESS_TEAM_DOMAIN || !config.CF_ACCESS_AUD) return null;
  const key = [config.CF_ACCESS_TEAM_DOMAIN, config.CF_ACCESS_AUD, ...config.ADMIN_EMAILS].join("|");
  if (cachedVerifier?.key !== key) {
    cachedVerifier = {
      key,
      verifier: createAccessVerifier({
        teamDomain: config.CF_ACCESS_TEAM_DOMAIN,
        audience: config.CF_ACCESS_AUD,
        allowedEmails: config.ADMIN_EMAILS,
      }),
    };
  }
  return cachedVerifier.verifier;
}

/** El host de la petición, sin fiarse de cabeceras X-Forwarded-*. */
export function requestHost(headers: Headers): string {
  return (headers.get("host") ?? "").trim().toLowerCase();
}

export function isAdminHost(host: string): boolean {
  const adminHost = getConfig().ADMIN_HOST?.trim().toLowerCase();
  return Boolean(adminHost) && host === adminHost;
}

/**
 * Autentica una petición al admin: tiene que llegar al host de admin y traer
 * un JWT válido de Access con un email permitido. Falla cerrado: si Access no
 * está configurado, nadie entra.
 */
export async function authenticateAdmin(headers: Headers): Promise<AdminAuthResult> {
  if (!isAdminHost(requestHost(headers))) return { ok: false, reason: "invalid_token" };

  const config = getConfig();
  if (process.env.NODE_ENV === "development" && config.DEV_ADMIN_EMAIL) {
    return { ok: true, email: config.DEV_ADMIN_EMAIL.toLowerCase() };
  }

  const verifier = getAccessVerifier();
  if (!verifier) return { ok: false, reason: "access_not_configured" };
  return verifier(headers.get(ACCESS_JWT_HEADER));
}

export class AdminAuthError extends Error {
  constructor(readonly reason: AdminAuthFailure) {
    super(`Acceso al admin denegado: ${reason}`);
    this.name = "AdminAuthError";
  }
}

/** Para los handlers del admin: devuelve el email o lanza `AdminAuthError`. */
export async function requireAdmin(request: Request): Promise<{ email: string }> {
  const result = await authenticateAdmin(request.headers);
  if (!result.ok) throw new AdminAuthError(result.reason);
  return { email: result.email };
}

/** Respuesta estándar de acceso denegado. */
export function forbidden(): Response {
  return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Protección contra CSRF en las peticiones que escriben. La cookie de Cloudflare
 * Access viaja en cualquier petición al host del admin, también en las que lanza
 * otra web abierta en el mismo navegador (un `fetch` con `mode: "no-cors"` y un
 * cuerpo `text/plain` no necesita preflight). Así que, además del JWT, la
 * petición tiene que venir del propio admin: `Sec-Fetch-Site: same-origin` si el
 * navegador lo manda, y `Origin` igual al host del admin. Sin ninguna de las
 * dos cabeceras, se rechaza: el admin solo se usa desde el navegador.
 */
export function isSameOriginWrite(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === requestHost(request.headers) && isAdminHost(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

/** Envuelve un handler del admin: comprueba la autenticación y el origen antes de ejecutarlo. */
export function adminHandler<C>(
  handler: (request: Request, context: C, admin: { email: string }) => Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    if (!isSameOriginWrite(request)) return forbidden();
    let admin: { email: string };
    try {
      admin = await requireAdmin(request);
    } catch (error) {
      if (error instanceof AdminAuthError) return forbidden();
      throw error;
    }
    return handler(request, context, admin);
  };
}
