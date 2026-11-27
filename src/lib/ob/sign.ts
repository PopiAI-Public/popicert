import * as vc from "@digitalbazaar/vc";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import type { DocumentLoader } from "./document-loader";
import type { KeyRing } from "./keys";

type UnsignedCredential = Record<string, unknown> & { issuer: string | { id: string } };

/**
 * Firma una credencial verificable con la clave activa: prueba Data Integrity
 * `eddsa-rdfc-2022` (Ed25519 con canonicalización RDF), con las mismas
 * librerías de Digital Bazaar que usan los verificadores del DCC.
 *
 * Sirve para las OpenBadgeCredential y para las listas de estado.
 */
export async function signCredential<T extends UnsignedCredential>(options: {
  credential: T;
  keyRing: KeyRing;
  documentLoader: DocumentLoader;
  /** Fecha de la firma (`proof.created`). Por defecto, ahora. */
  date?: Date;
}): Promise<T & { proof: Record<string, unknown> }> {
  const { credential, keyRing, documentLoader, date } = options;
  const issuerId = typeof credential.issuer === "string" ? credential.issuer : credential.issuer.id;
  if (issuerId !== keyRing.did) {
    throw new Error(`El emisor de la credencial (${issuerId}) no es el DID de PopiCert (${keyRing.did}).`);
  }
  const suite = new DataIntegrityProof({
    signer: keyRing.active.signer(),
    cryptosuite: eddsaRdfc2022,
    ...(date ? { date } : {}),
  });
  const signed = await vc.issue({
    // Copia: la librería no debe modificar el objeto de quien llama.
    credential: structuredClone(credential),
    suite,
    documentLoader,
    ...(date ? { now: date } : {}),
  });
  return signed as T & { proof: Record<string, unknown> };
}
