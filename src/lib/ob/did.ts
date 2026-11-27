import { DID_V1_CONTEXT_URL, MULTIKEY_V1_CONTEXT_URL } from "./contexts";

/**
 * DID `did:web` que corresponde a una URL pública.
 * https://certificados.popiai.es → did:web:certificados.popiai.es
 * Un puerto se codifica como %3A, según la especificación did:web.
 */
export function didWebFromUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`La URL pública no debe llevar ruta para did:web: ${publicUrl}`);
  }
  const host = url.port ? `${url.hostname}%3A${url.port}` : url.hostname;
  return `did:web:${host}`;
}

export interface VerificationMethod {
  id: string;
  type: "Multikey";
  controller: string;
  publicKeyMultibase: string;
}

export interface DidDocument {
  "@context": string[];
  id: string;
  verificationMethod: VerificationMethod[];
  assertionMethod: string[];
}

/** Identificador de la clave dentro del DID: `did:web:…#<publicKeyMultibase>`. */
export function verificationMethodId(did: string, publicKeyMultibase: string): string {
  return `${did}#${publicKeyMultibase}`;
}

/**
 * Documento DID con todas las claves públicas: la activa primero y después las retiradas.
 * Las retiradas no se quitan nunca, para que lo ya firmado siga verificando.
 */
export function buildDidDocument(did: string, publicKeys: readonly string[]): DidDocument {
  const unique = [...new Set(publicKeys)];
  const verificationMethod = unique.map((publicKeyMultibase) => ({
    id: verificationMethodId(did, publicKeyMultibase),
    type: "Multikey" as const,
    controller: did,
    publicKeyMultibase,
  }));
  return {
    "@context": [DID_V1_CONTEXT_URL, MULTIKEY_V1_CONTEXT_URL],
    id: did,
    verificationMethod,
    assertionMethod: verificationMethod.map((vm) => vm.id),
  };
}
