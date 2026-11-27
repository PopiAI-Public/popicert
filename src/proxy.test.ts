// La primera barrera: qué responde la app según el host y el token de Access.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAccessTeam, TEST_AUD, TEST_TEAM, type FakeAccessTeam } from "@/lib/security/testing";

let team: FakeAccessTeam;

// Las claves del equipo de Access salen del equipo falso en vez de descargarse.
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => (header: never, token: never) => team.getKey(header, token),
  };
});

const PUBLIC_HOST = "certificados.popiai.es";
const ADMIN_HOST = "certificados-admin.luismi.dev";
const ENV = {
  PUBLIC_URL: `https://${PUBLIC_HOST}`,
  ADMIN_HOST,
  CF_ACCESS_TEAM_DOMAIN: TEST_TEAM,
  CF_ACCESS_AUD: TEST_AUD,
  ADMIN_EMAILS: "info@popiai.es",
};

const { resetConfigCache } = await import("@/lib/config");
const { proxy } = await import("./proxy");
const { GET: whoami } = await import("./app/api/admin/whoami/route");

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

function request(host: string, path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`https://${host}${path}`, {
    method: init.method ?? "GET",
    headers: { host, ...init.headers },
  });
}

function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy", () => {
  const original = { ...process.env };

  beforeAll(async () => {
    team = await createFakeAccessTeam();
  });
  beforeEach(() => {
    Object.assign(process.env, ENV);
    delete process.env.DEV_ADMIN_EMAIL;
    resetConfigCache();
  });
  afterAll(() => {
    process.env = original;
    resetConfigCache();
  });

  describe("host público", () => {
    it.each(["/admin", "/admin/formaciones", "/api/admin/whoami", "/ADMIN", "/%61dmin", "//api/admin/x"])(
      "%s no existe (404), ni siquiera con un token válido",
      async (path) => {
        const token = await team.sign();
        for (const method of ["GET", ...WRITE_METHODS]) {
          const response = await proxy(request(PUBLIC_HOST, path, { method, headers: { "cf-access-jwt-assertion": token } }));
          expect(response.status, `${method} ${path}`).toBe(404);
        }
      },
    );

    it("las rutas públicas pasan sin token", async () => {
      for (const path of ["/", "/c/ABCD234567", "/status/1", "/.well-known/did.json", "/api/health"]) {
        expect(passedThrough(await proxy(request(PUBLIC_HOST, path))), path).toBe(true);
      }
    });

    it("no se fía de X-Forwarded-Host para colarse en el admin", async () => {
      const response = await proxy(
        request(PUBLIC_HOST, "/admin", {
          headers: { "x-forwarded-host": ADMIN_HOST, "cf-access-jwt-assertion": await team.sign() },
        }),
      );
      expect(response.status).toBe(404);
    });

    it("limita las peticiones a /verificar por IP", async () => {
      const ip = { "cf-connecting-ip": "198.51.100.23" };
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) {
        const response = await proxy(request(PUBLIC_HOST, "/verificar", { headers: ip }));
        statuses.push(passedThrough(response) ? 200 : response.status);
      }
      expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(statuses[30]).toBe(429);
      // Otra IP no está afectada.
      expect(passedThrough(await proxy(request(PUBLIC_HOST, "/verificar", { headers: { "cf-connecting-ip": "198.51.100.24" } })))).toBe(true);
    });
  });

  describe("host de admin", () => {
    async function withToken(path: string, token: string | undefined, method = "GET") {
      return proxy(request(ADMIN_HOST, path, { method, headers: token ? { "cf-access-jwt-assertion": token } : {} }));
    }

    it("con un token válido deja pasar al admin, sin caché ni indexación", async () => {
      const response = await withToken("/admin", await team.sign());
      expect(passedThrough(response)).toBe(true);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });

    it("la raíz redirige al admin", async () => {
      const response = await withToken("/", await team.sign());
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://${ADMIN_HOST}/admin`);
    });

    it("no sirve la web pública", async () => {
      expect((await withToken("/c/ABCD234567", await team.sign())).status).toBe(404);
    });

    it("sin JWT, caducado, con otra audiencia o con un email no permitido: 403 en todas las rutas y métodos", async () => {
      const tokens: Record<string, string | undefined> = {
        "sin JWT": undefined,
        caducado: await team.sign(undefined, { expiresIn: Math.floor(Date.now() / 1000) - 120 }),
        "otra audiencia": await team.sign(undefined, { audience: "otra" }),
        "email no permitido": await team.sign({ email: "intruso@example.com" }),
        "otra clave": await (await createFakeAccessTeam()).sign(),
      };
      for (const [name, token] of Object.entries(tokens)) {
        for (const path of ["/admin", "/api/admin/whoami", "/api/admin/certificados", "/"]) {
          for (const method of ["GET", ...WRITE_METHODS]) {
            const response = await withToken(path, token, method);
            expect(response.status, `${name}: ${method} ${path}`).toBe(403);
          }
        }
      }
    });

    it("si Access no está configurado, nadie entra", async () => {
      delete process.env.CF_ACCESS_AUD;
      resetConfigCache();
      expect((await withToken("/admin", await team.sign())).status).toBe(403);
    });

    it("el atajo de desarrollo no funciona fuera de `next dev`", async () => {
      process.env.DEV_ADMIN_EMAIL = "info@popiai.es";
      resetConfigCache();
      expect(process.env.NODE_ENV).not.toBe("development");
      expect((await withToken("/admin", undefined)).status).toBe(403);
    });
  });

  describe("segunda barrera en los handlers", () => {
    it("el handler del admin también exige host de admin y token, aunque el proxy no se ejecute", async () => {
      const ok = await whoami(request(ADMIN_HOST, "/api/admin/whoami", { headers: { "cf-access-jwt-assertion": await team.sign() } }), undefined);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ email: "info@popiai.es" });

      expect((await whoami(request(ADMIN_HOST, "/api/admin/whoami"), undefined)).status).toBe(403);
      const publicHost = await whoami(
        request(PUBLIC_HOST, "/api/admin/whoami", { headers: { "cf-access-jwt-assertion": await team.sign() } }),
        undefined,
      );
      expect(publicHost.status).toBe(403);
    });
  });

  it("rechaza una configuración con el admin en el host público", async () => {
    process.env.ADMIN_HOST = PUBLIC_HOST;
    resetConfigCache();
    const { getConfig } = await import("@/lib/config");
    expect(() => getConfig()).toThrow(/ADMIN_HOST/);
  });
});
