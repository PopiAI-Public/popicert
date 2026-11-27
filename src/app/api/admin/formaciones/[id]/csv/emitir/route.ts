import { issueCsv } from "@/lib/issuance/certificates";
import { handle, issueContext, json, readCsv } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";
/** Una tanda grande tarda: se firma cada certificado. */
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

/** Emite la tanda de un CSV. Idempotente: repetir el mismo CSV no emite nada nuevo. */
export const POST = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => {
    const { id } = await params;
    const csv = await readCsv(request);
    return json(await issueCsv(await issueContext(admin.email), id, csv));
  }),
);
