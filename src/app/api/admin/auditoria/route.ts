import { listAuditLog } from "@/lib/audit";
import { getPrisma } from "@/lib/db";
import { handle, json } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

/** Registro de auditoría, lo más reciente primero. `?objeto=<id>` filtra por formación o certificado. */
export const GET = adminHandler(async (request) =>
  handle(async () => {
    const params = new URL(request.url).searchParams;
    const targetId = params.get("objeto") ?? undefined;
    return json({ entries: await listAuditLog(getPrisma(), { targetId, take: 500 }) });
  }),
);
