/**
 * Normaliza una ruta para decidir si es del admin: decodifica %xx, pasa a
 * minúsculas, junta barras repetidas y resuelve `.` y `..`. Así `/%61dmin`,
 * `//admin` o `/x/../admin` no se cuelan como rutas públicas.
 */
export function normalizePath(pathname: string): string {
  let decoded = pathname;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  const segments: string[] = [];
  for (const segment of decoded.replace(/\\/g, "/").toLowerCase().split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** Rutas del admin: la interfaz (/admin) y su API (/api/admin). */
export function isAdminPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    path === "/admin" || path.startsWith("/admin/") || path === "/api/admin" || path.startsWith("/api/admin/")
  );
}

/** Rutas públicas con límite de peticiones (verificación y búsqueda). */
export function isRateLimitedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/verificar" || path.startsWith("/verificar/") || path.startsWith("/api/verificar");
}

/**
 * Páginas de certificado (/c/<código> y sus descargas). Llevan un límite más
 * holgado que /verificar: quien recorra códigos al azar se topa con él.
 */
export function isCertificatePath(pathname: string): boolean {
  return normalizePath(pathname).startsWith("/c/");
}

/** /c/<código> exacto, la URL que va en el QR y en la credencial. */
export function certificatePageCode(pathname: string): string | null {
  const match = /^\/c\/([A-Za-z0-9-]{1,40})\/?$/.exec(pathname);
  return match ? match[1]! : null;
}

/**
 * Negociación de contenido de /c/<código>: un cliente que pide JSON (y no
 * HTML) recibe la credencial firmada en la misma URL.
 */
export function wantsJson(accept: string | null): boolean {
  if (!accept) return false;
  const types = accept.split(",").map((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { type: type!.trim(), q: q ? Number(q.slice(2)) : 1 };
  });
  const quality = (names: string[]) => Math.max(0, ...types.filter((t) => names.includes(t.type)).map((t) => t.q));
  const json = quality(["application/ld+json", "application/json"]);
  const html = quality(["text/html", "application/xhtml+xml"]);
  return json > 0 && json >= html;
}
