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
