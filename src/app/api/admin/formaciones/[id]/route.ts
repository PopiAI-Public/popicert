import { getPrisma } from "@/lib/db";
import { deleteAchievement, getAchievement, updateAchievement } from "@/lib/issuance/achievements";
import { handle, json, readJson } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => {
    const { templateVersion, ...achievement } = await getAchievement(getPrisma(), (await params).id);
    return json({
      achievement,
      template: { versionId: templateVersion.id, name: templateVersion.templateName, version: templateVersion.version, fields: templateVersion.fields },
    });
  }),
);

/** Edita la formación. Solo afecta a los certificados que se emitan a partir de ahora. */
export const PUT = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => json({ achievement: await updateAchievement(getPrisma(), (await params).id, await readJson(request), admin.email) })),
);

/** Borra la formación, solo si no tiene certificados. */
export const DELETE = adminHandler<Context>(async (_request, { params }, admin) =>
  handle(async () => {
    await deleteAchievement(getPrisma(), (await params).id, admin.email);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }),
);
