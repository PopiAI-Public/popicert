import { SignJWT, UnsecuredJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccessVerifier, normalizeTeamDomain, type AccessVerifier } from "./access";
import { createFakeAccessTeam, TEST_ADMIN_EMAIL, TEST_AUD, TEST_TEAM, type FakeAccessTeam } from "./testing";

describe("verificación del JWT de Cloudflare Access", () => {
  let team: FakeAccessTeam;
  let verify: AccessVerifier;

  beforeAll(async () => {
    team = await createFakeAccessTeam();
    verify = createAccessVerifier(
      { teamDomain: TEST_TEAM, audience: TEST_AUD, allowedEmails: [TEST_ADMIN_EMAIL] },
      team.getKey,
    );
  });

  it("acepta un token válido del equipo, con la audiencia y un email permitido", async () => {
    expect(await verify(await team.sign())).toEqual({ ok: true, email: TEST_ADMIN_EMAIL });
    // El email se compara sin distinguir mayúsculas.
    expect(await verify(await team.sign({ email: "INFO@PopiAI.es" }))).toEqual({ ok: true, email: TEST_ADMIN_EMAIL });
  });

  it("sin token: rechazado", async () => {
    expect(await verify(undefined)).toEqual({ ok: false, reason: "missing_token" });
    expect(await verify("")).toEqual({ ok: false, reason: "missing_token" });
  });

  it("token caducado: rechazado", async () => {
    const expired = await team.sign(undefined, { expiresIn: Math.floor(Date.now() / 1000) - 120 });
    expect(await verify(expired)).toEqual({ ok: false, reason: "expired_token" });
  });

  it("token de otra aplicación de Access (otra audiencia): rechazado", async () => {
    expect(await verify(await team.sign(undefined, { audience: "otra-aplicacion" }))).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("token de otro equipo de Access (otro emisor): rechazado", async () => {
    expect(await verify(await team.sign(undefined, { issuer: "https://otro.cloudflareaccess.com" }))).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("email no permitido o sin email: rechazado", async () => {
    expect(await verify(await team.sign({ email: "intruso@example.com" }))).toEqual({
      ok: false,
      reason: "email_not_allowed",
    });
    expect(await verify(await team.sign({ common_name: "service-token" }))).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("token firmado con otra clave: rechazado", async () => {
    const impostor = await createFakeAccessTeam("test-key");
    expect(await verify(await impostor.sign())).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("token sin firmar (alg none) o con HMAC: rechazado", async () => {
    const unsigned = new UnsecuredJWT({ email: TEST_ADMIN_EMAIL })
      .setIssuer(`https://${TEST_TEAM}`)
      .setAudience(TEST_AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .encode();
    expect(await verify(unsigned)).toEqual({ ok: false, reason: "invalid_token" });

    const hmac = await new SignJWT({ email: TEST_ADMIN_EMAIL })
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .setIssuer(`https://${TEST_TEAM}`)
      .setAudience(TEST_AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("secreto-compartido-de-32-bytes!!"));
    expect(await verify(hmac)).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("basura: rechazado", async () => {
    expect(await verify("no.es.un.jwt")).toEqual({ ok: false, reason: "invalid_token" });
  });
});

describe("dominio del equipo", () => {
  it("acepta el nombre corto, el dominio o la URL", () => {
    expect(normalizeTeamDomain("popiai")).toBe("popiai.cloudflareaccess.com");
    expect(normalizeTeamDomain("PopiAI.cloudflareaccess.com")).toBe("popiai.cloudflareaccess.com");
    expect(normalizeTeamDomain("https://popiai.cloudflareaccess.com/")).toBe("popiai.cloudflareaccess.com");
  });
});
