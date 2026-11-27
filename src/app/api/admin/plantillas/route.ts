import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { adminHandler } from "@/lib/security/access";
import { json, readTemplateUpload, templateErrorResponse } from "@/lib/templates/http";
import { prepareTemplate } from "@/lib/templates/prepare";
import { createTemplate, listTemplates } from "@/lib/templates/repository";

export const dynamic = "force-dynamic";

/** Lista de plantillas con sus versiones. */
export const GET = adminHandler(async () => json({ templates: await listTemplates(getPrisma()) }));

/** Plantilla nueva: `multipart/form-data` con `name`, `svg` y las `fonts` que use. */
export const POST = adminHandler(async (request, _context, admin) => {
  try {
    const upload = await readTemplateUpload(request, { requireName: true });
    const prepared = await prepareTemplate({ svg: upload.svg, fonts: upload.fonts, publicUrl: getConfig().PUBLIC_URL });
    const created = await createTemplate(getPrisma(), { name: upload.name, prepared, actorEmail: admin.email });
    return json({ ...created, version: 1, fields: prepared.fields, report: prepared.report }, 201);
  } catch (error) {
    return templateErrorResponse(error);
  }
});
