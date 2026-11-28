import { getPrisma } from "@/lib/db";
import { getPublicCertificate } from "@/lib/public/certificate";

export const dynamic = "force-dynamic";

// Privado y sin indexar: al ocultar el certificado no debe quedar copia en ninguna caché.
const HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex, nofollow", Vary: "Accept" };

/**
 * La credencial firmada, tal cual se emitió. También responde en /c/<código>
 * con `Accept: application/ld+json` (el proxy reescribe la petición aquí).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const certificate = await getPublicCertificate(getPrisma(), (await params).code);
  if (!certificate) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  if (certificate.state === "hidden") {
    return Response.json(
      { error: "hidden", message: "Este certificado no es público por decisión de su titular." },
      { status: 410, headers: { ...HEADERS, "Cache-Control": "no-store" } },
    );
  }
  return new Response(JSON.stringify(certificate.credential, null, 2), {
    headers: {
      ...HEADERS,
      "Content-Type": "application/ld+json; charset=utf-8",
      "Content-Disposition": `inline; filename="certificado-${certificate.code}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
