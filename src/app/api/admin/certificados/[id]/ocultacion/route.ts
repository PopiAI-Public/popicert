import { getPrisma } from "@/lib/db";
import { setCertificateHidden } from "@/lib/issuance/certificates";
import { handle, json, readJson } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Oculta el certificado a petición del asistente (RGPD): `{ reason }`. */
export const POST = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => {
    const { id } = await params;
    const { reason } = await readJson(request);
    return json({ certificate: await setCertificateHidden(getPrisma(), id, { hidden: true, reason, actorEmail: admin.email }) });
  }),
);

/** Lo vuelve a mostrar. */
export const DELETE = adminHandler<Context>(async (_request, { params }, admin) =>
  handle(async () => {
    const { id } = await params;
    return json({ certificate: await setCertificateHidden(getPrisma(), id, { hidden: false, actorEmail: admin.email }) });
  }),
);
