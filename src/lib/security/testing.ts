// Utilidades para los tests de Cloudflare Access: un "equipo de Access" falso
// con su par de claves, para firmar JWT como lo haría Cloudflare.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export const TEST_TEAM = "popiai-test.cloudflareaccess.com";
export const TEST_AUD = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const TEST_ADMIN_EMAIL = "info@popiai.es";

export interface FakeAccessTeam {
  jwks: { keys: JWK[] };
  getKey: ReturnType<typeof createLocalJWKSet>;
  sign(claims?: Record<string, unknown>, options?: { issuer?: string; audience?: string; expiresIn?: string | number }): Promise<string>;
}

export async function createFakeAccessTeam(kid = "test-key"): Promise<FakeAccessTeam> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const jwks = { keys: [jwk] };
  return {
    jwks,
    getKey: createLocalJWKSet(jwks),
    async sign(claims = { email: TEST_ADMIN_EMAIL }, options = {}) {
      return new SignJWT({ type: "app", ...claims })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuer(options.issuer ?? `https://${TEST_TEAM}`)
        .setAudience([options.audience ?? TEST_AUD])
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? "5m")
        .sign(privateKey);
    },
  };
}
