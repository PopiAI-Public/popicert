import { getPrisma } from "@/lib/db";
import { adminHandler } from "@/lib/security/access";
import { json, templateErrorResponse } from "@/lib/templates/http";
import { getTemplateVersion, isUuid, TemplateNotFoundError } from "@/lib/templates/repository";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ versionId: string }> };

/** Detalle de una versión: campos, informe del saneado y fuentes (sin los ficheros). */
export const GET = adminHandler<Context>(async (_request, { params }) => {
  try {
    const { versionId } = await params;
    if (!isUuid(versionId)) throw new TemplateNotFoundError();
    const version = await getTemplateVersion(getPrisma(), versionId);
    return json({
      id: version.id,
      templateId: version.templateId,
      templateName: version.templateName,
      version: version.version,
      orientation: version.orientation,
      fields: version.fields,
      report: version.report,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      lockedAt: version.lockedAt,
      fonts: version.fonts.map((f) => ({ id: f.id, fileName: f.fileName, family: f.family, bold: f.bold, italic: f.italic, sha256: f.sha256 })),
    });
  } catch (error) {
    return templateErrorResponse(error);
  }
});
