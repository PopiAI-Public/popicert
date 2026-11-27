import { getPrisma } from "@/lib/db";
import { setAchievementArchived } from "@/lib/issuance/achievements";
import { handle, json } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Archiva la formación: deja de admitir emisiones. Sus certificados siguen igual. */
export const PUT = adminHandler<Context>(async (_request, { params }, admin) =>
  handle(async () => json({ achievement: await setAchievementArchived(getPrisma(), (await params).id, true, admin.email) })),
);

/** La recupera. */
export const DELETE = adminHandler<Context>(async (_request, { params }, admin) =>
  handle(async () => json({ achievement: await setAchievementArchived(getPrisma(), (await params).id, false, admin.email) })),
);
