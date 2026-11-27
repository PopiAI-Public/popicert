import { getPrisma } from "@/lib/db";
import { attendeeFields, getAchievement } from "@/lib/issuance/achievements";
import { EMAIL_COLUMN, toCsv } from "@/lib/issuance/csv";
import { download, handle, slug } from "@/lib/issuance/http";
import { sampleValues } from "@/lib/templates/samples";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** CSV de ejemplo con las columnas que pide la plantilla de la formación y una fila de muestra. */
export const GET = adminHandler<Context>(async (_request, { params }) =>
  handle(async () => {
    const achievement = await getAchievement(getPrisma(), (await params).id);
    const fields = attendeeFields(achievement.templateVersion.fields);
    const sample = sampleValues(fields);
    const csv = toCsv([
      [...fields.map((f) => f.key), EMAIL_COLUMN],
      [...fields.map((f) => sample[f.key] ?? ""), "maria.jose@example.com"],
    ]);
    return download(csv, "text/csv; charset=utf-8", `asistentes-${slug(achievement.name)}.csv`);
  }),
);
