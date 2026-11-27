import { OB_V3_CONTEXT_URL, VC_V2_CONTEXT_URL } from "./contexts";
import { hashedEmailIdentity, nameIdentity, type IdentityObject } from "./identity";

/** Perfil del emisor (`Profile` de Open Badges). */
export interface IssuerProfile {
  /** El DID del emisor, por ejemplo `did:web:certificados.popiai.es`. */
  id: string;
  name: string;
  url?: string;
  email?: string;
}

/** Una formación: el `Achievement` de Open Badges. */
export interface AchievementInput {
  /** URI estable de la formación. */
  id: string;
  name: string;
  description: string;
  /** Qué hay que hacer para obtenerlo, en texto (o Markdown). */
  criteria: string;
  image?: { id: string; caption?: string };
  /** Tipo de logro de Open Badges. Por defecto `Course`. */
  achievementType?: string;
}

export interface RecipientInput {
  name: string;
  /** Si se recoge, va con hash y sal; nunca en claro. */
  email?: string;
  /** Sal del hash del email. Si no se da, se genera una aleatoria. */
  emailSalt?: string;
}

export interface CredentialInput {
  /** URL pública del certificado, por ejemplo https://certificados.popiai.es/c/ABCD234567 */
  id: string;
  issuer: IssuerProfile;
  achievement: AchievementInput;
  recipient: RecipientInput;
  validFrom: Date;
  validUntil?: Date;
  /** Entrada de la lista de estado de revocación (KAN-10). */
  credentialStatus?: Record<string, unknown>;
}

export type OpenBadgeCredential = Record<string, unknown> & {
  "@context": string[];
  id: string;
  type: string[];
  issuer: Record<string, unknown> & { id: string };
  validFrom: string;
  validUntil?: string;
  credentialSubject: Record<string, unknown>;
  proof?: Record<string, unknown>;
};

/** Fecha XSD dateTime en UTC sin milisegundos: 2026-11-27T10:00:00Z */
export function toXsdDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("Fecha no válida");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Construye una `OpenBadgeCredential` (VC Data Model 2.0) **sin firmar**.
 * Es una función pura: no toca la base de datos ni las claves.
 */
export function buildOpenBadgeCredential(input: CredentialInput): OpenBadgeCredential {
  const { issuer, achievement, recipient } = input;

  const identifier: IdentityObject[] = [nameIdentity(recipient.name)];
  if (recipient.email) {
    identifier.push(hashedEmailIdentity(recipient.email, recipient.emailSalt));
  }

  const achievementObject: Record<string, unknown> = {
    id: achievement.id,
    type: ["Achievement"],
    achievementType: achievement.achievementType ?? "Course",
    name: achievement.name,
    description: achievement.description,
    criteria: { narrative: achievement.criteria },
  };
  if (achievement.image) {
    achievementObject.image = {
      id: achievement.image.id,
      type: "Image",
      ...(achievement.image.caption ? { caption: achievement.image.caption } : {}),
    };
  }

  const issuerObject: Record<string, unknown> & { id: string } = {
    id: issuer.id,
    type: ["Profile"],
    name: issuer.name,
    ...(issuer.url ? { url: issuer.url } : {}),
    ...(issuer.email ? { email: issuer.email } : {}),
  };

  const credential: OpenBadgeCredential = {
    "@context": [VC_V2_CONTEXT_URL, OB_V3_CONTEXT_URL],
    id: input.id,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    name: achievement.name,
    issuer: issuerObject,
    validFrom: toXsdDateTime(input.validFrom),
    credentialSubject: {
      type: ["AchievementSubject"],
      name: recipient.name.trim(),
      identifier,
      achievement: achievementObject,
    },
    // Sin `credentialSchema`: es opcional en Open Badges 3.0, y el tipo que usan los
    // ejemplos de 1EdTech (`1EdTechJsonSchemaValidator2019`) no está definido en
    // ningún contexto JSON-LD, así que la firma en modo estricto lo rechaza.
  };

  if (input.validUntil) {
    if (input.validUntil <= input.validFrom) {
      throw new Error("validUntil debe ser posterior a validFrom");
    }
    credential.validUntil = toXsdDateTime(input.validUntil);
  }
  if (input.credentialStatus) {
    credential.credentialStatus = input.credentialStatus;
  }

  return credential;
}
