import { getPrisma } from "@/lib/db";
import { getAchievement, getBadgeImage, MAX_BADGE_BYTES, setAchievementBadge } from "@/lib/issuance/achievements";
import { NotFoundError } from "@/lib/issuance/errors";
import { handle, json, readUploadedFile } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** La insignia actual, para verla en el admin (la URL pública no existe en el host del admin). */
export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => {
    const prisma = getPrisma();
    const achievement = await getAchievement(prisma, (await params).id);
    const image = achievement.badgeSha256 ? await getBadgeImage(prisma, achievement.badgeSha256) : null;
    if (!image) throw new NotFoundError("formación");
    return new Response(new Uint8Array(image.data), {
      headers: { "Content-Type": image.mimeType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }),
);

/** Imagen de la insignia: `multipart/form-data` con `image` (PNG o JPEG, hasta 1 MB). */
export const PUT = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => {
    const { id } = await params;
    const image = await readUploadedFile(request, "image", MAX_BADGE_BYTES, "La imagen");
    return json({ achievement: await setAchievementBadge(getPrisma(), id, image, admin.email) });
  }),
);
