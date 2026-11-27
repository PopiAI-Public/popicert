import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import { checkStatus, createCredential, createList } from "@digitalbazaar/vc-bitstring-status-list";
import type { DocumentLoader } from "../ob/document-loader";
import type { IssuerContext } from "../ob/issuer";
import { toXsdDateTime } from "../ob/credential";
import { signCredential } from "../ob/sign";
import type { StatusChecker } from "../ob/verify";

/**
 * Tamaño de cada lista: 131.072 entradas (16 KB sin comprimir), el mínimo que
 * pide W3C Bitstring Status List para que no se pueda deducir quién es quién.
 */
export const STATUS_LIST_SIZE = 131_072;

export const STATUS_PURPOSE = "revocation";

/** URL pública de la lista `listId`: https://certificados.popiai.es/status/1 */
export function statusListUrl(publicUrl: string, listId: number): string {
  if (!Number.isInteger(listId) || listId < 1) throw new Error(`Número de lista no válido: ${listId}`);
  return `${publicUrl.replace(/\/+$/, "")}/status/${listId}`;
}

/** Si `url` es una lista de estado de este PopiCert, su número; si no, `null`. */
export function parseStatusListUrl(publicUrl: string, url: string): number | null {
  const prefix = `${publicUrl.replace(/\/+$/, "")}/status/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  if (!/^[1-9]\d{0,8}$/.test(rest)) return null;
  return Number(rest);
}

export interface BitstringStatusListEntry {
  id: string;
  type: "BitstringStatusListEntry";
  statusPurpose: typeof STATUS_PURPOSE;
  statusListIndex: string;
  statusListCredential: string;
}

/** El `credentialStatus` que lleva cada credencial. */
export function credentialStatusEntry(listUrl: string, index: number): BitstringStatusListEntry {
  if (!Number.isInteger(index) || index < 0 || index >= STATUS_LIST_SIZE) {
    throw new Error(`Índice de estado fuera de rango: ${index}`);
  }
  return {
    id: `${listUrl}#${index}`,
    type: "BitstringStatusListEntry",
    statusPurpose: STATUS_PURPOSE,
    statusListIndex: String(index),
    statusListCredential: listUrl,
  };
}

/**
 * Construye y firma la `BitstringStatusListCredential` de una lista, con los
 * bits de `revokedIndices` a 1.
 */
export async function buildSignedStatusList(options: {
  issuer: IssuerContext;
  listId: number;
  revokedIndices: Iterable<number>;
  size?: number;
  date?: Date;
}): Promise<Record<string, unknown>> {
  const size = options.size ?? STATUS_LIST_SIZE;
  if (size < STATUS_LIST_SIZE) throw new Error(`Una lista de estado tiene como mínimo ${STATUS_LIST_SIZE} entradas.`);
  const list = await createList({ length: size });
  for (const index of options.revokedIndices) list.setStatus(index, true);

  const id = statusListUrl(options.issuer.publicUrl, options.listId);
  const unsigned = await createCredential({ id, list, statusPurpose: STATUS_PURPOSE });
  const date = options.date ?? new Date();
  return signCredential({
    credential: { ...unsigned, issuer: options.issuer.did, validFrom: toXsdDateTime(date) },
    keyRing: options.issuer.keyRing,
    documentLoader: options.issuer.documentLoader,
    date,
  });
}

/**
 * Comprobador de estado para `verifyCredential`, con la librería de Digital
 * Bazaar: descarga la lista con el cargador (sin red: la saca de la base de
 * datos), verifica su firma y que el emisor coincide, y mira el bit.
 *
 * Ojo con la librería: `verified: true` solo significa que se pudo comprobar; la
 * credencial está revocada si `status` es `true`.
 */
export function createStatusChecker(documentLoader: DocumentLoader): StatusChecker {
  return async (credential) => {
    const result = await checkStatus({
      credential,
      documentLoader,
      suite: new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 }),
      verifyBitstringStatusListCredential: true,
      verifyMatchingIssuers: true,
    });
    if (!result.verified || !result.results?.length) {
      return { verified: false, message: `No se pudo comprobar el estado: ${result.error?.message ?? "sin resultado"}` };
    }
    const revoked = result.results.some(
      (r) => r.credentialStatus.statusPurpose === STATUS_PURPOSE && r.status === true,
    );
    return revoked ? { verified: false, message: "Revocada." } : { verified: true };
  };
}
