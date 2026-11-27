import { getPrisma } from "@/lib/db";
import { previewCsv } from "@/lib/issuance/certificates";
import { handle, json, readCsv } from "@/lib/issuance/http";
import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Valida un CSV fila a fila sin emitir nada. Es un POST porque lleva el CSV en
 * el cuerpo, pero no escribe en la base de datos.
 */
export const POST = adminHandler<Context>(async (request, { params }) =>
  handle(async () => {
    const { id } = await params;
    return json(await previewCsv(getPrisma(), id, await readCsv(request)));
  }),
);
