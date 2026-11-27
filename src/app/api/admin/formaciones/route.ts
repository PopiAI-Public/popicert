import { getPrisma } from "@/lib/db";
import { createAchievement, listAchievements } from "@/lib/issuance/achievements";
import { handle, json, readJson } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

/** Formaciones. Con `?archivadas=1`, también las archivadas. */
export const GET = adminHandler(async (request) =>
  handle(async () => {
    const includeArchived = new URL(request.url).searchParams.get("archivadas") === "1";
    return json({ achievements: await listAchievements(getPrisma(), { includeArchived }) });
  }),
);

/** Formación nueva: `{ name, description, criteria, hours, templateVersionId, trainingValues }`. */
export const POST = adminHandler(async (request, _context, admin) =>
  handle(async () => json({ achievement: await createAchievement(getPrisma(), await readJson(request), admin.email) }, 201)),
);
