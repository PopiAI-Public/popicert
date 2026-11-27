import { getPrisma } from "@/lib/db";
import { getCertificate, renderCertificatePdf } from "@/lib/issuance/certificates";
import { download, handle, issuerName } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** El PDF del certificado, con los datos privados (DNI…) si la plantilla los lleva. */
export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => {
    const prisma = getPrisma();
    const certificate = await getCertificate(prisma, (await params).id);
    const pdf = await renderCertificatePdf(prisma, certificate, issuerName());
    return download(pdf, "application/pdf", `certificado-${certificate.code}.pdf`, "inline");
  }),
);
