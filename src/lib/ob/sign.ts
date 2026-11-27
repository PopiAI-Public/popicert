import * as vc from "@digitalbazaar/vc";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import type { OpenBadgeCredential } from "./credential";
import type { DocumentLoader } from "./document-loader";
import type { KeyRing } from "./keys";

/**
 * Firma una credencial con la clave activa: prueba Data Integrity
 * `eddsa-rdfc-2022` (Ed25519 con canonicalización RDF), con las mismas
 * librerías de Digital Bazaar que usan los verificadores del DCC.
 */
export async function signCredential(options: {
  credential: OpenBadgeCredential;
  keyRing: KeyRing;
  documentLoader: DocumentLoader;
  /** Fecha de la firma (`proof.created`). Por defecto, ahora. */
  date?: Date;
}): Promise<OpenBadgeCredential> {
  const { credential, keyRing, documentLoader, date } = options;
  if (credential.issuer.id !== keyRing.did) {
    throw new Error(`El emisor de la credencial (${credential.issuer.id}) no es el DID de PopiCert (${keyRing.did}).`);
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
  return signed as OpenBadgeCredential;
}
