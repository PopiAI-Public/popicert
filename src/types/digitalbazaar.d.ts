// Tipos mínimos para las librerías de Digital Bazaar, que no publican los suyos.
// Solo cubren lo que usa PopiCert.

declare module "@digitalbazaar/vc" {
  export interface VerifyResult {
    verified: boolean;
    error?: Error & { errors?: Error[] };
    results?: Array<{ verified: boolean; error?: Error }>;
    statusResult?: { verified: boolean; [key: string]: unknown };
  }
  export function issue(options: {
    credential: Record<string, unknown>;
    suite: unknown;
    documentLoader: unknown;
    now?: string | Date;
  }): Promise<Record<string, unknown>>;
  export function verifyCredential(options: {
    credential: Record<string, unknown>;
    suite: unknown;
    documentLoader: unknown;
    now?: string | Date;
    checkStatus?: (options: { credential: Record<string, unknown> }) => Promise<{ verified: boolean }>;
  }): Promise<VerifyResult>;
}

declare module "@digitalbazaar/data-integrity" {
  export class DataIntegrityProof {
    constructor(options: { signer?: unknown; cryptosuite: unknown; date?: string | Date });
  }
}

declare module "@digitalbazaar/eddsa-rdfc-2022-cryptosuite" {
  export const cryptosuite: unknown;
}

declare module "@digitalbazaar/ed25519-multikey" {
  export interface Ed25519KeyPair {
    id: string;
    controller: string;
    publicKeyMultibase: string;
    signer(): unknown;
    verifier(): unknown;
  }
  export function generate(options?: { id?: string; controller?: string; seed?: Uint8Array }): Promise<Ed25519KeyPair>;
  export function from(key: Record<string, unknown>): Promise<Ed25519KeyPair>;
}

declare module "@digitalbazaar/credentials-context" {
  export const contexts: Map<string, unknown>;
}

declare module "@digitalbazaar/data-integrity-context" {
  const value: { contexts: Map<string, unknown> };
  export default value;
}

declare module "@digitalbazaar/multikey-context" {
  const value: { contexts: Map<string, unknown>; CONTEXT_URL: string };
  export default value;
}

declare module "did-context" {
  const value: { contexts: Map<string, unknown>; CONTEXT_URL: string };
  export default value;
}
