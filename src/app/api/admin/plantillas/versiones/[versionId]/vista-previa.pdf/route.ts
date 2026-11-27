import { getPrisma } from "@/lib/db";
import { adminHandler } from "@/lib/security/access";
import { previewPdfResponse, templateErrorResponse } from "@/lib/templates/http";
import { getTemplateVersion, isUuid, TemplateNotFoundError } from "@/lib/templates/repository";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ versionId: string }> };

/** Vista previa con datos de ejemplo (largos y con tildes). */
export const GET = adminHandler<Context>(async (_request, { params }) => {
  try {
    const { versionId } = await params;
    if (!isUuid(versionId)) throw new TemplateNotFoundError();
    return await previewPdfResponse(await getTemplateVersion(getPrisma(), versionId));
  } catch (error) {
    return templateErrorResponse(error);
  }
});
