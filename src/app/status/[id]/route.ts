import { getPrisma } from "@/lib/db";
import { getStatusListCredential } from "@/lib/status/repository";

export const dynamic = "force-dynamic";

/**
 * Lista de estado de revocación publicada (`BitstringStatusListCredential`
 * firmada). Los verificadores la descargan para saber si un certificado está
 * revocado. Se cachea 5 minutos: una revocación tarda como mucho eso en verse.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[1-9]\d{0,8}$/.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const credential = await getStatusListCredential(getPrisma(), Number(id));
  if (!credential) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(credential, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
