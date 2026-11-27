import { getIssuerContext, SigningKeyNotConfiguredError } from "@/lib/ob/issuer";

export const dynamic = "force-dynamic";

/**
 * Documento DID de `did:web:<host>`: las claves públicas del emisor, la activa
 * y todas las retiradas. Lo consultan los verificadores externos.
 */
export async function GET(): Promise<Response> {
  try {
    const { didDocument } = await getIssuerContext();
    return Response.json(didDocument, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    if (error instanceof SigningKeyNotConfiguredError) {
      return Response.json({ error: "issuer_not_configured" }, { status: 503 });
    }
    throw error;
  }
}
