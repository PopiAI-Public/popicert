import { getPrisma } from "@/lib/db";
import { searchCertificates } from "@/lib/issuance/certificates";
import { handle, json } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

/** Búsqueda en todos los certificados por nombre o código (`?q=`). Sin `q`, los últimos emitidos. */
export const GET = adminHandler(async (request) =>
  handle(async () => {
    const query = new URL(request.url).searchParams.get("q") ?? undefined;
    return json({ certificates: await searchCertificates(getPrisma(), { query }) });
  }),
);
