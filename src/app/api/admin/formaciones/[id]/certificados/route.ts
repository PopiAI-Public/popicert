import { getPrisma } from "@/lib/db";
import { getAchievement } from "@/lib/issuance/achievements";
import { issueCertificate, searchCertificates } from "@/lib/issuance/certificates";
import { handle, issueContext, json, readJson } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Certificados de la formación, con `?q=` para buscar por nombre o código. */
export const GET = adminHandler<Context>(async (request, { params }) =>
  handle(async () => {
    const prisma = getPrisma();
    const { id } = await params;
    await getAchievement(prisma, id);
    const query = new URL(request.url).searchParams.get("q") ?? undefined;
    return json({ certificates: await searchCertificates(prisma, { achievementId: id, query, take: 2000 }) });
  }),
);

/**
 * Emisión individual: `{ values: { nombre, … }, email? }` con los campos del
 * asistente de la plantilla. Si el asistente ya tiene certificado, 200 con el
 * que tenía; si se emite, 201.
 */
export const POST = adminHandler<Context>(async (request, { params }, admin) =>
  handle(async () => {
    const { id } = await params;
    const body = await readJson(request);
    const values = typeof body.values === "object" && body.values !== null ? (body.values as Record<string, unknown>) : {};
    const email = typeof body.email === "string" ? body.email : null;
    const outcome = await issueCertificate(await issueContext(admin.email), id, { values, email });
    return json(outcome, outcome.status === "issued" ? 201 : 200);
  }),
);
