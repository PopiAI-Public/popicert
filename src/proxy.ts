import { NextResponse, type NextRequest } from "next/server";
import { authenticateAdmin, isAdminHost, requestHost } from "@/lib/security/access";
import { certificatePageCode, isAdminPath, isCertificatePath, isRateLimitedPath, normalizePath, wantsJson } from "@/lib/security/paths";
import { clientIp, createRateLimiter } from "@/lib/security/rate-limit";

/**
 * Primera barrera, antes de cualquier ruta:
 *
 * - En el host público, el admin **no existe**: /admin y /api/admin dan 404.
 * - En el host de admin, todo exige un JWT válido de Cloudflare Access (403 si
 *   no), y solo se sirve el admin.
 * - En el host público, /verificar y /c/ tienen límite de peticiones.
 * - /c/<código> con `Accept: application/ld+json` (o JSON) devuelve la credencial firmada.
 *
 * No es la única barrera: cada handler del admin vuelve a autenticar con
 * `adminHandler`/`requireAdmin`, por si una ruta se escapa del proxy.
 */

const verifyLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
const certificateLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

function tooManyRequests(): NextResponse {
  return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const adminPath = isAdminPath(pathname);

  if (isAdminHost(requestHost(request.headers))) {
    const auth = await authenticateAdmin(request.headers);
    if (!auth.ok) {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (normalizePath(pathname) === "/") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    if (!adminPath) return notFound();
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (adminPath) return notFound();

  if (isRateLimitedPath(pathname) && !verifyLimiter.hit(clientIp(request.headers))) return tooManyRequests();
  if (isCertificatePath(pathname) && !certificateLimiter.hit(clientIp(request.headers))) return tooManyRequests();

  // La URL del certificado también es la de su credencial: con Accept JSON, la credencial firmada.
  const code = certificatePageCode(pathname);
  if (code) {
    const json = wantsJson(request.headers.get("accept"));
    const response = json
      ? NextResponse.rewrite(new URL(`/c/${code}/credencial.json`, request.url))
      : NextResponse.next();
    response.headers.set("Vary", "Accept");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  // La imagen de la vista previa y las descargas de /c/ tampoco se indexan ni se guardan en cachés compartidas.
  if (isCertificatePath(pathname)) {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Todo menos los ficheros estáticos de Next, que son públicos e iguales para todos.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
