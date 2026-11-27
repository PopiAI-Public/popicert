import { getPrisma } from "@/lib/db";
import { getCertificate } from "@/lib/issuance/certificates";
import { handle, json } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Detalle de un certificado, con todos sus datos (también los privados: es el admin). */
export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => json({ certificate: await getCertificate(getPrisma(), (await params).id) })),
);
