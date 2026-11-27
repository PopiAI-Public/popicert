/**
 * Límite de peticiones en memoria, por ventana fija. Basta para una sola
 * instancia de la app: protege /verificar y la búsqueda de que alguien las
 * use para recorrer códigos de certificado.
 */
export interface RateLimiter {
  /** `true` si la petición entra; `false` si se ha pasado del límite. */
  hit(key: string, now?: number): boolean;
}

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(key, now = Date.now()) {
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        if (windows.size >= maxKeys) {
          // Limpieza: fuera las ventanas caducadas; si aún no hay sitio, la más antigua.
          for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value!);
        }
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}

/**
 * IP del cliente. Detrás de Cloudflare la da `CF-Connecting-IP`; el servidor
 * solo es accesible por el túnel de Cloudflare (KAN-16), así que no se puede
 * falsificar desde fuera.
 */
export function clientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip")?.trim() || "unknown";
}
