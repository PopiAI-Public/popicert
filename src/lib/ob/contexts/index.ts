import { contexts as credentialsContexts } from "@digitalbazaar/credentials-context";
import dataIntegrityContext from "@digitalbazaar/data-integrity-context";
import multikeyContext from "@digitalbazaar/multikey-context";
import didContext from "did-context";

// Copia literal del contexto oficial de 1EdTech, sin tocar.
// Se comprueba contra el publicado con `npm run check-contexts`.
import obContext303 from "./ob-v3p0-context-3.0.3.json";

export const VC_V2_CONTEXT_URL = "https://www.w3.org/ns/credentials/v2";
export const OB_V3_CONTEXT_URL = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
export const DID_V1_CONTEXT_URL = "https://www.w3.org/ns/did/v1";
export const MULTIKEY_V1_CONTEXT_URL = "https://w3id.org/security/multikey/v1";

function pick(map: Map<string, unknown>, url: string): unknown {
  const ctx = map.get(url);
  if (!ctx) throw new Error(`Contexto JSON-LD no empaquetado: ${url}`);
  return ctx;
}

/**
 * Todos los contextos JSON-LD que PopiCert necesita para firmar y verificar,
 * empaquetados para no descargar nada en tiempo de ejecución.
 */
export const STATIC_CONTEXTS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  [VC_V2_CONTEXT_URL, pick(credentialsContexts, VC_V2_CONTEXT_URL)],
  [OB_V3_CONTEXT_URL, obContext303],
  ["https://w3id.org/security/data-integrity/v2", pick(dataIntegrityContext.contexts, "https://w3id.org/security/data-integrity/v2")],
  [MULTIKEY_V1_CONTEXT_URL, pick(multikeyContext.contexts, MULTIKEY_V1_CONTEXT_URL)],
  [DID_V1_CONTEXT_URL, pick(didContext.contexts, DID_V1_CONTEXT_URL)],
]);
