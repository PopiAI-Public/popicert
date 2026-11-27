// Utilidades para los tests del núcleo Open Badges. No se usan en producción.
import { buildOpenBadgeCredential, type CredentialInput } from "./credential";
import { createIssuerContext, type IssuerContext } from "./issuer";

export const TEST_PUBLIC_URL = "https://certificados.popiai.es";

/** Semillas fijas y públicas, solo para tests: cada una genera siempre la misma clave. */
export const TEST_SEED_A = Buffer.alloc(32, 0xa1).toString("base64url");
export const TEST_SEED_B = Buffer.alloc(32, 0xb2).toString("base64url");
export const TEST_SEED_EVIL = Buffer.alloc(32, 0xee).toString("base64url");

export function testIssuerContext(seed = TEST_SEED_A, retiredPublicKeys: string[] = []): Promise<IssuerContext> {
  return createIssuerContext({
    publicUrl: TEST_PUBLIC_URL,
    signingKeySeed: seed,
    retiredPublicKeys,
    profile: { name: "PopiAI", url: "https://popiai.es", email: "info@popiai.es" },
  });
}

export function sampleCredentialInput(ctx: IssuerContext, overrides: Partial<CredentialInput> = {}): CredentialInput {
  return {
    id: `${TEST_PUBLIC_URL}/c/ABCD234567`,
    issuer: ctx.profile,
    achievement: {
      id: "urn:uuid:6f1c1b2e-6a5e-4c55-9d7b-1f0d8f1a2b3c",
      name: "Inteligencia artificial generativa para pymes",
      description: "Formación presencial de 8 horas sobre IA generativa aplicada al trabajo diario.",
      criteria: "Asistir a la formación presencial completa.",
      image: { id: `${TEST_PUBLIC_URL}/badges/ia-pymes.png`, caption: "Insignia de la formación" },
    },
    recipient: { name: "María José Núñez Peña", email: "Maria.Nunez@example.com", emailSalt: "0123456789abcdef" },
    validFrom: new Date("2026-11-20T09:00:00Z"),
    ...overrides,
  };
}

export function sampleCredential(ctx: IssuerContext, overrides: Partial<CredentialInput> = {}) {
  return buildOpenBadgeCredential(sampleCredentialInput(ctx, overrides));
}
