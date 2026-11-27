import { randomBytes } from "node:crypto";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";
import type { Ed25519KeyPair } from "@digitalbazaar/ed25519-multikey";
import { buildDidDocument, verificationMethodId, type DidDocument } from "./did";

const SEED_BYTES = 32;
const MULTIBASE_ED25519_PUBLIC = /^z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

/**
 * La clave de firma se guarda como su semilla Ed25519 de 32 bytes en base64url
 * (43 caracteres). Solo vive en un secreto del despliegue: nunca en la base de
 * datos, en el repo ni en los logs.
 */
export function generateSigningKeySeed(): string {
  return randomBytes(SEED_BYTES).toString("base64url");
}

export function decodeSeed(seed: string): Uint8Array {
  const trimmed = seed.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(trimmed)) {
    throw new Error("La clave de firma debe ser una semilla Ed25519 de 32 bytes en base64url (43 caracteres).");
  }
  const bytes = Buffer.from(trimmed, "base64url");
  if (bytes.length !== SEED_BYTES) {
    throw new Error("La clave de firma debe ser una semilla Ed25519 de 32 bytes.");
  }
  return new Uint8Array(bytes);
}

export function assertPublicKeyMultibase(value: string): string {
  if (!MULTIBASE_ED25519_PUBLIC.test(value)) {
    throw new Error(`Clave pública Ed25519 no válida (se espera multibase z6Mk…): ${value}`);
  }
  return value;
}

/**
 * Conjunto de claves del emisor:
 * - `active`: la que firma ahora (con su parte privada).
 * - `retiredPublicKeys`: las anteriores. Solo se guarda su parte pública y
 *   siguen en el documento DID para siempre.
 */
export interface KeyRing {
  did: string;
  active: Ed25519KeyPair;
  retiredPublicKeys: readonly string[];
}

export async function keyPairFromSeed(did: string, seed: string): Promise<Ed25519KeyPair> {
  const keyPair = await Ed25519Multikey.generate({ controller: did, seed: decodeSeed(seed) });
  // Fijamos el id explícitamente para no depender del formato interno de la librería.
  keyPair.id = verificationMethodId(did, keyPair.publicKeyMultibase);
  return keyPair;
}

export async function createKeyRing(options: {
  did: string;
  signingKeySeed: string;
  retiredPublicKeys?: readonly string[];
}): Promise<KeyRing> {
  const active = await keyPairFromSeed(options.did, options.signingKeySeed);
  const retiredPublicKeys = (options.retiredPublicKeys ?? [])
    .map((key) => assertPublicKeyMultibase(key.trim()))
    .filter((key) => key !== active.publicKeyMultibase);
  return { did: options.did, active, retiredPublicKeys };
}

export function didDocumentForKeyRing(ring: KeyRing): DidDocument {
  return buildDidDocument(ring.did, [ring.active.publicKeyMultibase, ...ring.retiredPublicKeys]);
}
