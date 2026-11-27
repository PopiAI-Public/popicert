// Guardas de estructura: que nadie añada por descuido una ruta que escriba fuera
// del admin, o una ruta del admin sin autenticación.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = join(import.meta.dirname, "..", "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(APP_DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const rel = (f: string) => relative(APP_DIR, f).split(sep).join("/");
const WRITE_EXPORT = /export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b/;

describe("estructura de rutas", () => {
  it("las rutas que escriben (POST/PUT/PATCH/DELETE) solo existen bajo /api/admin", () => {
    const offenders = files
      .filter((f) => /\/route\.ts$/.test(rel(f)) || rel(f) === "route.ts")
      .filter((f) => WRITE_EXPORT.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((path) => !path.startsWith("api/admin/"));
    expect(offenders).toEqual([]);
  });

  it("todos los handlers de /api/admin pasan por adminHandler", () => {
    const handlers = files.filter((f) => rel(f).startsWith("api/admin/") && rel(f).endsWith("route.ts"));
    expect(handlers.length).toBeGreaterThan(0);
    for (const file of handlers) {
      const source = readFileSync(file, "utf8");
      const exported = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b(.*)/g)];
      for (const [, method, rest] of exported) {
        expect(rest, `${rel(file)} ${method}`).toMatch(/=\s*adminHandler(<[\w\s,]+>)?\(/);
      }
    }
  });

  it("las Server Actions solo existen en el admin y autentican", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use server["']/m.test(source)) continue;
      expect(rel(file), "Server Action fuera del admin").toMatch(/^admin\//);
      expect(source, `${rel(file)} no autentica`).toMatch(/requireAdmin|authenticateAdmin/);
    }
  });

  it("las páginas del admin autentican por sí mismas", () => {
    const pages = files.filter((f) => rel(f).startsWith("admin/") && /page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(readFileSync(page, "utf8"), rel(page)).toMatch(/authenticateAdmin|requireAdmin/);
    }
  });
});
