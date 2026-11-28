import { getPrisma } from "@/lib/db";
import { handle, json, readJson } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";
import { isUuid, TemplateNotFoundError, updateTemplateFields } from "@/lib/templates/repository";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ versionId: string }> };

/** Configuración de los campos (`{ fields: [...] }`). Solo mientras la versión no se haya usado. */
export const PUT = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => {
    const { versionId } = await params;
    if (!isUuid(versionId)) throw new TemplateNotFoundError();
    const body = await readJson(request);
    const fields = await updateTemplateFields(getPrisma(), { versionId, fields: body.fields, actorEmail: admin.email });
    return json({ fields });
  }),
);
