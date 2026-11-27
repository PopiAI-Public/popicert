import { createHash, randomBytes } from "node:crypto";

/** `IdentityObject` de Open Badges 3.0. */
export interface IdentityObject {
  type: "IdentityObject";
  identityType: "name" | "emailAddress";
  hashed: boolean;
  identityHash: string;
  salt?: string;
}

/** El nombre del asistente va en claro: es lo que se muestra en el certificado. */
export function nameIdentity(name: string): IdentityObject {
  const clean = name.trim();
  if (!clean) throw new Error("El nombre del asistente es obligatorio.");
  return { type: "IdentityObject", identityType: "name", hashed: false, identityHash: clean };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * El email nunca va en claro: `sha256$<hex de sha256(email + sal)>`, con una sal
 * aleatoria por credencial, como indica Open Badges 3.0 para `IdentityHash`.
 * Quien conozca el email puede comprobar que la credencial es suya; quien no, no
 * puede sacarlo de la credencial.
 */
export function hashedEmailIdentity(email: string, salt: string = randomBytes(16).toString("hex")): IdentityObject {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) throw new Error(`Email no válido: ${email}`);
  const digest = createHash("sha256").update(normalized + salt, "utf8").digest("hex");
  return {
    type: "IdentityObject",
    identityType: "emailAddress",
    hashed: true,
    identityHash: `sha256$${digest}`,
    salt,
  };
}

/** Comprueba si un email corresponde a un `IdentityObject` con hash. */
export function emailMatchesIdentity(email: string, identity: IdentityObject): boolean {
  if (!identity.hashed || identity.identityType !== "emailAddress" || identity.salt === undefined) return false;
  return hashedEmailIdentity(email, identity.salt).identityHash === identity.identityHash;
}
