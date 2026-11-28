import { getPrisma } from "@/lib/db";
import { getIssuerContext } from "@/lib/ob/issuer";
import { verifyWithStatus } from "@/lib/public/certificate";

export const dynamic = "force-dynamic";

/** Una credencial ocupa unos 3 KB; con esto sobra y no se puede usar para agotar memoria. */
const MAX_BYTES = 64 * 1024;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Verifica una credencial subida en /verificar. Es un POST porque lleva el
 * JSON en el cuerpo, pero **no escribe nada**: solo lee la lista de estado.
 * Tiene el límite de peticiones de /verificar (src/proxy.ts).
 */
export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) return json({ error: "Falta el contenido." }, 400);
  if (length > MAX_BYTES) return json({ error: "El fichero es demasiado grande para ser una credencial." }, 413);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "El fichero es demasiado grande para ser una credencial." }, 413);

  let credential: unknown;
  try {
    credential = JSON.parse(text);
  } catch {
    return json({ error: "El fichero no es JSON." }, 422);
  }
  const prisma = getPrisma();
  const issuer = await getIssuerContext();
  const report = await verifyWithStatus(prisma, issuer, credential);
  // Si es una credencial nuestra, enlace a su página (solo si sigue siendo pública).
  const id = typeof credential === "object" && credential !== null ? (credential as { id?: unknown }).id : undefined;
  let page: string | null = null;
  const prefix = `${issuer.publicUrl}/c/`;
  if (report.checks.signature.outcome === "passed" && report.checks.issuer.outcome === "passed" && typeof id === "string" && id.startsWith(prefix)) {
    const row = await prisma.credential.findFirst({ where: { code: id.slice(prefix.length), hiddenAt: null }, select: { code: true } });
    if (row) page = id;
  }
  return json({ report, page });
}
