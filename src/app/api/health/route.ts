import { isDatabaseReachable } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Comprobación de salud para Dokploy: 200 con la base de datos accesible, 503 sin ella. */
export async function GET(): Promise<Response> {
  const database = await isDatabaseReachable();
  return Response.json(
    { status: database ? "ok" : "error", database: database ? "ok" : "unreachable" },
    { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
