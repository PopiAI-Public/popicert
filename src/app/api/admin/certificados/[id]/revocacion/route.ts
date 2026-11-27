import { revokeCertificate } from "@/lib/issuance/certificates";
import { handle, issueContext, json, readJson } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Revoca el certificado: `{ reason }`. No tiene vuelta atrás. */
export const POST = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => {
    const { id } = await params;
    const { reason } = await readJson(request);
    return json(await revokeCertificate(await issueContext(admin.email), id, reason));
  }),
);
