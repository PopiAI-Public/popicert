import { getPrisma } from "@/lib/db";
import { adminHandler } from "@/lib/security/access";
import { TemplateError } from "@/lib/templates/errors";
import { json, templateErrorResponse } from "@/lib/templates/http";
import { isUuid, TemplateNotFoundError, updateTemplateFields } from "@/lib/templates/repository";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ versionId: string }> };

/** Configuración de los campos (`{ fields: [...] }`). Solo mientras la versión no se haya usado. */
export const PUT = adminHandler<Context>(async (request, { params }, admin) => {
  try {
    const { versionId } = await params;
    if (!isUuid(versionId)) throw new TemplateNotFoundError();
    const body = (await request.json().catch(() => {
      throw new TemplateError("El cuerpo tiene que ser JSON.");
    })) as { fields?: unknown };
    const fields = await updateTemplateFields(getPrisma(), { versionId, fields: body?.fields, actorEmail: admin.email });
    return json({ fields });
  } catch (error) {
    return templateErrorResponse(error);
  }
});
