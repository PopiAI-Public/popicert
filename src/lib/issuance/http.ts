/**
 * Piezas comunes de las rutas del admin de formaciones y certificados.
 */
import { getConfig } from "@/lib/config";
import { getPrisma } from "@/lib/db";
import { getIssuerContext, SigningKeyNotConfiguredError } from "@/lib/ob/issuer";
import { TemplateError } from "@/lib/templates/errors";
import { json } from "@/lib/templates/http";
import { TemplateNotFoundError } from "@/lib/templates/repository";
import type { IssueContext } from "./certificates";
import { MAX_CSV_BYTES } from "./csv";
import { IssuanceError, NotFoundError } from "./errors";

export { json };

/** Errores conocidos a respuestas JSON con un mensaje para el admin; el resto, para arriba. */
export function adminErrorResponse(error: unknown): Response {
  if (error instanceof IssuanceError || error instanceof TemplateError) return json({ error: error.message }, 422);
  if (error instanceof NotFoundError || error instanceof TemplateNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof SigningKeyNotConfiguredError) {
    return json({ error: "No se puede emitir: falta la clave de firma en la configuración del servidor." }, 503);
  }
  throw error;
}

/** Envuelve el cuerpo de una ruta para convertir los errores conocidos en respuestas. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => {
    throw new IssuanceError("El cuerpo tiene que ser JSON.");
  });
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new IssuanceError("El cuerpo tiene que ser un objeto JSON.");
  return body as Record<string, unknown>;
}

function checkLength(request: Request, max: number, what: string): void {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) throw new IssuanceError("Falta el tamaño de la subida (Content-Length).");
  // Un poco de margen para la envoltura del formulario.
  if (length > max + 64 * 1024) throw new IssuanceError(`${what} ocupa más de ${max / 1024 / 1024} MB.`);
}

/** Un fichero de un `multipart/form-data`. */
export async function readUploadedFile(request: Request, field: string, max: number, what: string): Promise<Buffer> {
  checkLength(request, max, what);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new IssuanceError("La subida no es un formulario válido.");
  }
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new IssuanceError(`Falta ${what.toLowerCase()}.`);
  if (file.size > max) throw new IssuanceError(`${what} ocupa más de ${max / 1024 / 1024} MB.`);
  return Buffer.from(await file.arrayBuffer());
}

/** El CSV de una tanda: como fichero (`csv` en un formulario) o como texto (`text/csv`). */
export async function readCsv(request: Request): Promise<string> {
  const type = request.headers.get("content-type") ?? "";
  const bytes = type.startsWith("multipart/form-data")
    ? await readUploadedFile(request, "csv", MAX_CSV_BYTES, "El CSV")
    : (checkLength(request, MAX_CSV_BYTES, "El CSV"), Buffer.from(await request.arrayBuffer()));
  // Excel puede guardar en Windows-1252 («CSV» a secas): si no es UTF-8 válido, se lee así.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function issueContext(actorEmail: string): Promise<IssueContext> {
  return { prisma: getPrisma(), issuer: await getIssuerContext(), actorEmail };
}

export function issuerName(): string {
  return getConfig().ISSUER_NAME;
}

/** Descarga de un fichero generado: sin caché y sin que el navegador adivine el tipo. */
export function download(body: Uint8Array | string, contentType: string, fileName: string, disposition: "attachment" | "inline" = "attachment"): Response {
  const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "");
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Nombre de fichero a partir de un texto: «IA generativa para pymes» → «ia-generativa-para-pymes». */
export function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "formacion"
  );
}
