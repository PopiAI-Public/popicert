import { describe, expect, it } from "vitest";
import { isAdminPath, isRateLimitedPath, normalizePath } from "./paths";
import { clientIp, createRateLimiter } from "./rate-limit";

describe("rutas del admin", () => {
  it.each([
    "/admin",
    "/admin/",
    "/admin/formaciones",
    "/api/admin",
    "/api/admin/whoami",
    "/ADMIN",
    "/Api/Admin/x",
    "//admin",
    "/%61dmin",
    "/%2561dmin",
    "/api%2Fadmin/x",
    "/x/../admin",
    "/./admin",
    "\\admin",
  ])("%s es del admin", (path) => {
    expect(isAdminPath(path)).toBe(true);
  });

  it.each(["/", "/c/ABCD234567", "/verificar", "/administracion", "/api/health", "/status/1", "/.well-known/did.json"])(
    "%s no es del admin",
    (path) => {
      expect(isAdminPath(path)).toBe(false);
    },
  );

  it("normaliza sin romperse con codificaciones inválidas", () => {
    expect(normalizePath("/%E0%A4%A")).toBe("/%e0%a4%a");
    expect(normalizePath("/../../etc/passwd")).toBe("/etc/passwd");
  });
});

describe("límite de peticiones", () => {
  it("se aplica a /verificar", () => {
    expect(isRateLimitedPath("/verificar")).toBe(true);
    expect(isRateLimitedPath("/api/verificar")).toBe(true);
    expect(isRateLimitedPath("/c/ABCD234567")).toBe(false);
  });

  it("deja pasar hasta el límite por ventana y por clave", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map(() => limiter.hit("a", 0))).toEqual([true, true, true, false]);
    expect(limiter.hit("b", 0)).toBe(true);
    expect(limiter.hit("a", 1000)).toBe(true);
  });

  it("no crece sin límite en memoria", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("b", 0)).toBe(true);
    expect(limiter.hit("c", 0)).toBe(true);
    // "a" se ha descartado para hacer sitio, así que vuelve a empezar.
    expect(limiter.hit("a", 0)).toBe(true);
  });

  it("toma la IP de Cloudflare", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": " 203.0.113.7 " }))).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
