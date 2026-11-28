import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { getPublicCertificate, renderPublicPdf } from "@/lib/public/certificate";

export const dynamic = "force-dynamic";

/** El diploma en PDF, sin los campos privados de la plantilla (ver `renderPublicPdf`). */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const prisma = getPrisma();
  const certificate = await getPublicCertificate(prisma, (await params).code);
  if (!certificate || certificate.state === "hidden") {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const rendered = await renderPublicPdf(prisma, certificate.id, getConfig().ISSUER_NAME);
  if (!rendered) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(rendered.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certificado-${rendered.code}.pdf"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
