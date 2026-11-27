import { getPrisma } from "@/lib/db";
import { getCertificate } from "@/lib/issuance/certificates";
import { download, handle } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** La credencial Open Badges 3.0 firmada, tal cual se emitió. */
export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => {
    const certificate = await getCertificate(getPrisma(), (await params).id);
    return download(JSON.stringify(certificate.credential, null, 2), "application/ld+json", `certificado-${certificate.code}.json`);
  }),
);
