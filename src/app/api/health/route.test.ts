import { beforeEach, describe, expect, it, vi } from "vitest";

const reachable = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/db", () => ({ isDatabaseReachable: () => reachable() }));

const { GET } = await import("./route");

describe("GET /api/health", () => {
  beforeEach(() => reachable.mockReset());

  it("responde 200 con la base de datos accesible", async () => {
    reachable.mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("responde 503 sin base de datos", async () => {
    reachable.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", database: "unreachable" });
  });
});
