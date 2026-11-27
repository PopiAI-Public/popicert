import { getPrisma } from "@/lib/db";
import { getAchievement } from "@/lib/issuance/achievements";
import { exportRows, searchCertificates } from "@/lib/issuance/certificates";
import { toCsv } from "@/lib/issuance/csv";
import { download, handle, slug } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Todos los certificados de la formación con su nombre, enlace y código, para enviarlos por nuestros medios. */
export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => {
    const prisma = getPrisma();
    const achievement = await getAchievement(prisma, (await params).id);
    const certificates = await searchCertificates(prisma, { achievementId: achievement.id, take: 2000 });
    return download(toCsv(exportRows(certificates)), "text/csv; charset=utf-8", `certificados-${slug(achievement.name)}.csv`);
  }),
);
