import { MULTIKEY_V1_CONTEXT_URL, STATIC_CONTEXTS } from "./contexts";
import type { DidDocument } from "./did";

export interface RemoteDocument {
  contextUrl: null;
  documentUrl: string;
  document: unknown;
}

export type DocumentLoader = (url: string) => Promise<RemoteDocument>;

/**
 * Resuelve documentos propios de PopiCert que no son estáticos, como las listas
 * de estado (`/status/<n>`), leyéndolos de la base de datos. Devuelve
 * `undefined` si la URL no es suya.
 */
export type LocalDocumentResolver = (url: string) => Promise<unknown | undefined>;

/**
 * Cargador de documentos JSON-LD **sin red**.
 *
 * Solo resuelve los contextos empaquetados, los documentos DID que se le pasan
 * (los de PopiCert) y lo que devuelva `resolveLocal`. Cualquier otra URL es un
 * error: así ni la firma ni la verificación dependen de descargas, y nadie
 * puede inyectar contextos.
 */
export function createDocumentLoader(
  didDocuments: readonly DidDocument[],
  resolveLocal?: LocalDocumentResolver,
): DocumentLoader {
  const dids = new Map(didDocuments.map((doc) => [doc.id, doc]));

  return async function documentLoader(url: string): Promise<RemoteDocument> {
    const context = STATIC_CONTEXTS.get(url);
    if (context) {
      return { contextUrl: null, documentUrl: url, document: context };
    }

    if (resolveLocal && !url.startsWith("did:")) {
      const local = await resolveLocal(url);
      if (local !== undefined) {
        // Copia: quien lo use no puede modificar lo que hay guardado.
        return { contextUrl: null, documentUrl: url, document: structuredClone(local) };
      }
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
