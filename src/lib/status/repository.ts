import { randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createDocumentLoader, type DocumentLoader } from "../ob/document-loader";
import type { IssuerContext } from "../ob/issuer";
import {
  buildSignedStatusList,
  credentialStatusEntry,
  parseStatusListUrl,
  STATUS_LIST_SIZE,
  statusListUrl,
  type BitstringStatusListEntry,
} from "./status-list";

/**
 * Cuando una lista llega a la mitad de su capacidad se abre la siguiente, para
 * que asignar un índice aleatorio siga encontrando hueco a la primera y la
 * población de cada lista siga siendo grande. Con unos 300 certificados al año,
 * la primera lista da para siglos.
 */
const MAX_ENTRIES_PER_LIST = STATUS_LIST_SIZE / 2;
const MAX_ALLOCATION_ATTEMPTS = 32;

export interface AllocatedStatus {
  entryId: string;
  listId: number;
  index: number;
  credentialStatus: BitstringStatusListEntry;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Crea la lista `listId` firmada y vacía, si no existe. Seguro con llamadas simultáneas. */
async function ensureStatusList(prisma: PrismaClient, issuer: IssuerContext, listId: number): Promise<void> {
  const existing = await prisma.statusList.findUnique({ where: { id: listId }, select: { id: true } });
  if (existing) return;
  const credential = await buildSignedStatusList({ issuer, listId, revokedIndices: [] });
  await prisma.statusList.createMany({
    data: [{ id: listId, size: STATUS_LIST_SIZE, credential: credential as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
}

/** La lista en la que se asignan índices ahora: la última, o la siguiente si está a media capacidad. */
async function currentListId(prisma: PrismaClient, issuer: IssuerContext): Promise<number> {
  const last = await prisma.statusList.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  let listId = last?.id ?? 1;
  if (last) {
    const used = await prisma.statusEntry.count({ where: { listId } });
    if (used >= MAX_ENTRIES_PER_LIST) listId += 1;
  }
  await ensureStatusList(prisma, issuer, listId);
  return listId;
}

/**
 * Reserva una posición de revocación para una credencial nueva.
 *
 * El índice es aleatorio (no sigue el orden de emisión) y la restricción
 * `UNIQUE (list_id, index)` de la base de datos garantiza que dos emisiones
 * simultáneas nunca reciben el mismo: si chocan, la segunda prueba otro.
 */
export async function allocateStatusEntry(prisma: PrismaClient, issuer: IssuerContext): Promise<AllocatedStatus> {
  const listId = await currentListId(prisma, issuer);
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const index = randomInt(STATUS_LIST_SIZE);
    try {
      const entry = await prisma.statusEntry.create({ data: { listId, index }, select: { id: true } });
      return {
        entryId: entry.id,
        listId,
        index,
        credentialStatus: credentialStatusEntry(statusListUrl(issuer.publicUrl, listId), index),
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("No se ha encontrado un índice libre en la lista de estado.");
}

export class StatusEntryNotFoundError extends Error {
  constructor(entryId: string) {
    super(`No existe la entrada de estado ${entryId}.`);
    this.name = "StatusEntryNotFoundError";
  }
}

export interface RevocationResult {
  revokedAt: Date;
  reason: string;
  /** `true` si ya estaba revocada: no se toca nada y se devuelve la revocación original. */
  alreadyRevoked: boolean;
}

/**
 * Revoca: guarda el motivo y la fecha, vuelve a firmar la lista con el bit a 1
 * y la publica. La credencial emitida no se toca.
 *
 * Todo va en una transacción que bloquea la fila de la lista (`FOR UPDATE`): dos
 * revocaciones a la vez en la misma lista se hacen una detrás de otra, y la
 * segunda firma la lista ya con el bit de la primera.
 */
export async function revokeStatusEntry(
  prisma: PrismaClient,
  issuer: IssuerContext,
  options: { entryId: string; reason: string; now?: Date },
): Promise<RevocationResult> {
  return prisma.$transaction((tx) => revokeStatusEntryInTransaction(tx, issuer, options), { timeout: 15_000 });
}

/**
 * Lo mismo que `revokeStatusEntry`, dentro de una transacción que ya está
 * abierta: la revocación de un certificado (KAN-11) actualiza también su fila
 * en la misma transacción.
 */
export async function revokeStatusEntryInTransaction(
  tx: Prisma.TransactionClient,
  issuer: IssuerContext,
  options: { entryId: string; reason: string; now?: Date },
): Promise<RevocationResult> {
  const reason = options.reason.trim();
  if (!reason) throw new Error("El motivo de la revocación es obligatorio.");

  const entry = await tx.statusEntry.findUnique({ where: { id: options.entryId } });
  if (!entry) throw new StatusEntryNotFoundError(options.entryId);

  await tx.$queryRaw`SELECT id FROM status_list WHERE id = ${entry.listId} FOR UPDATE`;

  // Releída con la lista ya bloqueada, por si otra transacción la acaba de revocar.
  const current = await tx.statusEntry.findUniqueOrThrow({ where: { id: entry.id } });
  if (current.revokedAt) {
    return { revokedAt: current.revokedAt, reason: current.revocationReason ?? "", alreadyRevoked: true };
  }

  const revokedAt = options.now ?? new Date();
  await tx.statusEntry.update({
    where: { id: entry.id },
    data: { revokedAt, revocationReason: reason },
  });

  const revoked = await tx.statusEntry.findMany({
    where: { listId: entry.listId, revokedAt: { not: null } },
    select: { index: true },
  });
  const list = await tx.statusList.findUniqueOrThrow({ where: { id: entry.listId }, select: { size: true } });
  const signedList = await buildSignedStatusList({
    issuer,
    listId: entry.listId,
    size: list.size,
    revokedIndices: revoked.map((r) => r.index),
    date: revokedAt,
  });
  await tx.statusList.update({
    where: { id: entry.listId },
    data: { credential: signedList as Prisma.InputJsonValue, version: { increment: 1 } },
  });

  return { revokedAt, reason, alreadyRevoked: false };
}

/** La `BitstringStatusListCredential` publicada de la lista `listId`, o `null`. */
export async function getStatusListCredential(
  prisma: PrismaClient,
  listId: number,
): Promise<Record<string, unknown> | null> {
  const list = await prisma.statusList.findUnique({ where: { id: listId }, select: { credential: true } });
  return (list?.credential as Record<string, unknown> | undefined) ?? null;
}

/**
 * Cargador de documentos para verificar con estado: además de los contextos y
 * el DID, resuelve las listas de estado propias leyéndolas de la base de datos,
 * sin pasar por HTTP.
 */
export function createStatusAwareDocumentLoader(prisma: PrismaClient, issuer: IssuerContext): DocumentLoader {
  return createDocumentLoader([issuer.didDocument], async (url) => {
    const listId = parseStatusListUrl(issuer.publicUrl, url);
    if (listId === null) return undefined;
    const credential = await getStatusListCredential(prisma, listId);
    if (!credential) throw new Error(`No existe la lista de estado ${url}.`);
    return credential;
  });
}
