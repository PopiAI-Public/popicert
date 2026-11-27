import { getConfig } from "../config";
import type { IssuerProfile } from "./credential";
import { didWebFromUrl, type DidDocument } from "./did";
import { createDocumentLoader, type DocumentLoader } from "./document-loader";
import { createKeyRing, didDocumentForKeyRing, type KeyRing } from "./keys";

/** Todo lo que hace falta para firmar y verificar como PopiCert. */
export interface IssuerContext {
  /** URL pública sin barra final, por ejemplo https://certificados.popiai.es */
  publicUrl: string;
  did: string;
  profile: IssuerProfile;
  keyRing: KeyRing;
  didDocument: DidDocument;
  documentLoader: DocumentLoader;
}

export class SigningKeyNotConfiguredError extends Error {
  constructor() {
    super("No hay clave de firma configurada (POPICERT_SIGNING_KEY). Genera una con `npm run keygen`.");
    this.name = "SigningKeyNotConfiguredError";
  }
}

export async function createIssuerContext(options: {
  publicUrl: string;
  signingKeySeed: string;
  retiredPublicKeys?: readonly string[];
  profile: Omit<IssuerProfile, "id">;
}): Promise<IssuerContext> {
  const did = didWebFromUrl(options.publicUrl);
  const keyRing = await createKeyRing({
    did,
    signingKeySeed: options.signingKeySeed,
    retiredPublicKeys: options.retiredPublicKeys,
  });
  const didDocument = didDocumentForKeyRing(keyRing);
  return {
    publicUrl: options.publicUrl.replace(/\/+$/, ""),
    did,
    profile: { id: did, ...options.profile },
    keyRing,
    didDocument,
    documentLoader: createDocumentLoader([didDocument]),
  };
}

let cached: Promise<IssuerContext> | undefined;

/** Contexto del emisor a partir de la configuración del entorno. Se crea una vez por proceso. */
export function getIssuerContext(): Promise<IssuerContext> {
  if (!cached) {
    const config = getConfig();
    if (!config.POPICERT_SIGNING_KEY) {
      return Promise.reject(new SigningKeyNotConfiguredError());
    }
    cached = createIssuerContext({
      publicUrl: config.PUBLIC_URL,
      signingKeySeed: config.POPICERT_SIGNING_KEY,
      retiredPublicKeys: config.POPICERT_RETIRED_PUBLIC_KEYS,
      profile: { name: config.ISSUER_NAME, url: config.ISSUER_URL, email: config.ISSUER_EMAIL },
    });
    // Si falla (clave mal formada), que el siguiente intento lo vuelva a probar y dé el error.
    cached.catch(() => {
      cached = undefined;
    });
  }
  return cached;
}
