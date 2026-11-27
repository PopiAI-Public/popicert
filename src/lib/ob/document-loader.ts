import { MULTIKEY_V1_CONTEXT_URL, STATIC_CONTEXTS } from "./contexts";
import type { DidDocument } from "./did";

export interface RemoteDocument {
  contextUrl: null;
  documentUrl: string;
  document: unknown;
}

export type DocumentLoader = (url: string) => Promise<RemoteDocument>;

/**
 * Cargador de documentos JSON-LD **sin red**.
 *
 * Solo resuelve los contextos empaquetados y los documentos DID que se le pasan
 * (los de PopiCert). Cualquier otra URL es un error: así ni la firma ni la
 * verificación dependen de descargas, y nadie puede inyectar contextos.
 */
export function createDocumentLoader(didDocuments: readonly DidDocument[]): DocumentLoader {
  const dids = new Map(didDocuments.map((doc) => [doc.id, doc]));

  return async function documentLoader(url: string): Promise<RemoteDocument> {
    const context = STATIC_CONTEXTS.get(url);
    if (context) {
      return { contextUrl: null, documentUrl: url, document: context };
    }

    if (url.startsWith("did:")) {
      const [did, fragment] = url.split("#", 2);
      const doc = did ? dids.get(did) : undefined;
      if (!doc) throw new Error(`DID desconocido: ${did}`);
      if (!fragment) {
        return { contextUrl: null, documentUrl: url, document: doc };
      }
      const method = doc.verificationMethod.find((vm) => vm.id === url);
      if (!method) throw new Error(`Clave no publicada en el documento DID: ${url}`);
      return {
        contextUrl: null,
        documentUrl: url,
        document: { "@context": MULTIKEY_V1_CONTEXT_URL, ...method },
      };
    }

    throw new Error(`Documento no disponible sin conexión: ${url}`);
  };
}
