import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { adminHandler } from "@/lib/security/access";
import { json, readTemplateUpload, templateErrorResponse } from "@/lib/templates/http";
import { prepareTemplate } from "@/lib/templates/prepare";
import { createTemplateVersion, getLatestVersionFields, isUuid, TemplateNotFoundError } from "@/lib/templates/repository";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ templateId: string }> };

/** Versión nueva de una plantilla. Hereda la configuración de los campos que siguen. */
export const POST = adminHandler<Context>(async (request, { params }, admin) => {
  try {
    const { templateId } = await params;
    if (!isUuid(templateId)) throw new TemplateNotFoundError();
    const prisma = getPrisma();
    const previousFields = await getLatestVersionFields(prisma, templateId);
    const upload = await readTemplateUpload(request, { requireName: false });
    const prepared = await prepareTemplate({ svg: upload.svg, fonts: upload.fonts, publicUrl: getConfig().PUBLIC_URL, previousFields });
    const created = await createTemplateVersion(prisma, { templateId, prepared, actorEmail: admin.email });
    return json({ templateId, ...created, fields: prepared.fields, report: prepared.report }, 201);
  } catch (error) {
    return templateErrorResponse(error);
  }
});
