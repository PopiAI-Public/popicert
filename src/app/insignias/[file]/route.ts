import { createHash } from "node:crypto";
import { getPrisma } from "@/lib/db";
import { getBadgeImage } from "@/lib/issuance/achievements";

export const dynamic = "force-dynamic";

/**
 * Imagen de la insignia de una formación, la que enlazan las credenciales
 * (`achievement.image`). La URL lleva el sha256 de la imagen, así que lo que
 * sirve una URL no cambia nunca y se puede cachear para siempre.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const match = /^([0-9a-f]{64})\.(png|jpg)$/.exec((await params).file);
  const image = match ? await getBadgeImage(getPrisma(), match[1]!) : null;
  // La URL promete un contenido concreto: si la base de datos no lo tiene tal cual, no se sirve otro.
  if (!image || (match![2] === "png") !== (image.mimeType === "image/png") || createHash("sha256").update(image.data).digest("hex") !== match![1]) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
