import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_LENGTH, generateCertificateCode, normalizeCertificateCode } from "./code";
import { buildOpenBadgeCredential } from "./credential";
import { buildDidDocument, didWebFromUrl } from "./did";
import { hashedEmailIdentity, nameIdentity } from "./identity";
import { createKeyRing, decodeSeed, generateSigningKeySeed } from "./keys";
import { sampleCredentialInput, TEST_SEED_A, testIssuerContext } from "./testing";

describe("did:web", () => {
  it("deriva el DID del host público", () => {
    expect(didWebFromUrl("https://certificados.popiai.es")).toBe("did:web:certificados.popiai.es");
    expect(didWebFromUrl("https://certificados.popiai.es/")).toBe("did:web:certificados.popiai.es");
    expect(didWebFromUrl("http://localhost:3000")).toBe("did:web:localhost%3A3000");
    expect(() => didWebFromUrl("https://example.com/sub")).toThrow();
  });

  it("publica todas las claves como Multikey y en assertionMethod", () => {
    const doc = buildDidDocument("did:web:x.example", ["z6MkA", "z6MkB", "z6MkA"]);
    expect(doc["@context"]).toEqual(["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"]);
    expect(doc.verificationMethod).toEqual([
      { id: "did:web:x.example#z6MkA", type: "Multikey", controller: "did:web:x.example", publicKeyMultibase: "z6MkA" },
      { id: "did:web:x.example#z6MkB", type: "Multikey", controller: "did:web:x.example", publicKeyMultibase: "z6MkB" },
    ]);
    expect(doc.assertionMethod).toEqual(["did:web:x.example#z6MkA", "did:web:x.example#z6MkB"]);
  });
});

describe("claves", () => {
  it("genera semillas de 32 bytes en base64url", () => {
    const seed = generateSigningKeySeed();
    expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(decodeSeed(seed)).toHaveLength(32);
    expect(generateSigningKeySeed()).not.toBe(seed);
  });

  it("rechaza semillas mal formadas", () => {
    expect(() => decodeSeed("corta")).toThrow();
    expect(() => decodeSeed("=".repeat(43))).toThrow();
  });

  it("la misma semilla da siempre la misma clave pública", async () => {
    const a = await createKeyRing({ did: "did:web:x.example", signingKeySeed: TEST_SEED_A });
    const b = await createKeyRing({ did: "did:web:x.example", signingKeySeed: TEST_SEED_A });
    expect(a.active.publicKeyMultibase).toBe(b.active.publicKeyMultibase);
    expect(a.active.publicKeyMultibase).toMatch(/^z6Mk/);
    expect(a.active.id).toBe(`did:web:x.example#${a.active.publicKeyMultibase}`);
  });

  it("rechaza claves retiradas mal formadas y no duplica la activa", async () => {
    await expect(
      createKeyRing({ did: "did:web:x.example", signingKeySeed: TEST_SEED_A, retiredPublicKeys: ["no-es-una-clave"] }),
    ).rejects.toThrow(/no válida/);
    const ring = await createKeyRing({ did: "did:web:x.example", signingKeySeed: TEST_SEED_A });
    const again = await createKeyRing({
      did: "did:web:x.example",
      signingKeySeed: TEST_SEED_A,
      retiredPublicKeys: [ring.active.publicKeyMultibase],
    });
    expect(again.retiredPublicKeys).toEqual([]);
  });
});

describe("identidad del asistente", () => {
  it("el nombre va en claro y no puede estar vacío", () => {
    expect(nameIdentity("  Ana  ").identityHash).toBe("Ana");
    expect(() => nameIdentity("   ")).toThrow();
  });

  it("el hash del email usa una sal aleatoria por credencial", () => {
    const a = hashedEmailIdentity("ana@example.com");
    const b = hashedEmailIdentity("ana@example.com");
    expect(a.salt).not.toBe(b.salt);
    expect(a.identityHash).not.toBe(b.identityHash);
    expect(hashedEmailIdentity("ana@example.com", "sal").identityHash).toBe(
      hashedEmailIdentity(" ANA@example.com ", "sal").identityHash,
    );
  });
});

describe("credencial sin firmar", () => {
  it("valida las fechas", async () => {
    const ctx = await testIssuerContext();
    const input = sampleCredentialInput(ctx);
    expect(() => buildOpenBadgeCredential({ ...input, validUntil: input.validFrom })).toThrow(/validUntil/);
    expect(buildOpenBadgeCredential(input).validFrom).toBe("2026-11-20T09:00:00Z");
  });

  it("sin email no incluye ningún identificador de email", async () => {
    const ctx = await testIssuerContext();
    const input = sampleCredentialInput(ctx);
    const credential = buildOpenBadgeCredential({ ...input, recipient: { name: "Ana" } });
    expect((credential.credentialSubject as { identifier: unknown[] }).identifier).toHaveLength(1);
  });
});

describe("códigos de certificado", () => {
  it("son de 10 caracteres del alfabeto sin ambigüedades", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateCertificateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it("no se repiten en la práctica", () => {
    const codes = new Set(Array.from({ length: 10_000 }, generateCertificateCode));
    expect(codes.size).toBe(10_000);
  });

  it("normaliza lo que escribe una persona", () => {
    expect(normalizeCertificateCode(" abcd-2345 67 ")).toBe("ABCD234567");
    expect(normalizeCertificateCode("ABCD23456O")).toBeNull();
    expect(normalizeCertificateCode("corto")).toBeNull();
  });
});
