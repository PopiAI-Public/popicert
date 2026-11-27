import { readFileSync } from "node:fs";
import Ajv2019 from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDocumentLoader } from "./document-loader";
import { emailMatchesIdentity, type IdentityObject } from "./identity";
import { signCredential } from "./sign";
import {
  sampleCredential,
  TEST_SEED_A,
  TEST_SEED_B,
  TEST_SEED_EVIL,
  testIssuerContext,
} from "./testing";
import { verifyCredential } from "./verify";
import type { IssuerContext } from "./issuer";
import type { OpenBadgeCredential } from "./credential";

// Ni la firma ni la verificación pueden tocar la red: si alguien llama a fetch, el test revienta.
beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Acceso a la red prohibido en firma y verificación");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-11-27T10:00:00Z");

async function issue(ctx: IssuerContext, overrides = {}): Promise<OpenBadgeCredential> {
  return signCredential({
    credential: sampleCredential(ctx, overrides),
    keyRing: ctx.keyRing,
    documentLoader: ctx.documentLoader,
    date: new Date("2026-11-20T09:00:00Z"),
  });
}

function verifyWith(ctx: IssuerContext, credential: unknown, now = NOW) {
  return verifyCredential({ credential, documentLoader: ctx.documentLoader, expectedIssuer: ctx.did, now });
}

/** Todas las rutas a valores hoja de un objeto JSON. */
function leafPaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => leafPaths(item, [...path, i]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, [...path, key]));
  }
  return [path];
}

function mutateAt(credential: OpenBadgeCredential, path: (string | number)[]): OpenBadgeCredential {
  const copy = structuredClone(credential) as Record<string | number, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  const current = target[last];
  if (typeof current === "string") {
    // Cambia un carácter sin romper el formato (fechas siguen siendo fechas).
    target[last] = /\d/.test(current.slice(-2, -1)) && current.endsWith("Z")
      ? current.replace(/(\d)Z$/, (_, d: string) => `${(Number(d) + 1) % 10}Z`)
      : current.slice(0, -1) + (current.endsWith("x") ? "y" : "x");
  } else if (typeof current === "number") {
    target[last] = current + 1;
  } else if (typeof current === "boolean") {
    target[last] = !current;
  } else {
    target[last] = "x";
  }
  return copy as unknown as OpenBadgeCredential;
}

describe("emisión y verificación Open Badges 3.0", () => {
  let ctx: IssuerContext;
  let signed: OpenBadgeCredential;

  beforeAll(async () => {
    ctx = await testIssuerContext();
    signed = await issue(ctx);
  });

  it("emite una OpenBadgeCredential firmada con eddsa-rdfc-2022 que verifica", async () => {
    expect(signed.type).toEqual(["VerifiableCredential", "OpenBadgeCredential"]);
    expect(signed.issuer.id).toBe("did:web:certificados.popiai.es");
    expect(signed.proof).toMatchObject({
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      proofPurpose: "assertionMethod",
      verificationMethod: `did:web:certificados.popiai.es#${ctx.keyRing.active.publicKeyMultibase}`,
    });

    const report = await verifyWith(ctx, signed);
    expect(report).toEqual({
      verified: true,
      checks: {
        signature: { outcome: "passed" },
        issuer: { outcome: "passed" },
        validity: { outcome: "passed" },
        status: { outcome: "skipped" },
      },
    });
  });

  it("cumple el JSON Schema oficial de la AchievementCredential de 1EdTech", () => {
    const schema = JSON.parse(
      readFileSync(new URL("../../../tests/fixtures/1edtech/ob_v3p0_achievementcredential_schema.json", import.meta.url), "utf8"),
    );
    const ajv = new Ajv2019({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(signed);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("lleva el nombre en claro y el email solo con hash y sal", () => {
    const subject = signed.credentialSubject as { name: string; identifier: IdentityObject[] };
    expect(subject.name).toBe("María José Núñez Peña");
    const [name, email] = subject.identifier;
    expect(name).toEqual({ type: "IdentityObject", identityType: "name", hashed: false, identityHash: "María José Núñez Peña" });
    expect(email).toMatchObject({ identityType: "emailAddress", hashed: true, salt: "0123456789abcdef" });
    expect(email!.identityHash).toMatch(/^sha256\$[0-9a-f]{64}$/);
    expect(JSON.stringify(signed).toLowerCase()).not.toContain("maria.nunez@example.com");
    expect(emailMatchesIdentity("  MARIA.NUNEZ@example.com ", email!)).toBe(true);
    expect(emailMatchesIdentity("otra@example.com", email!)).toBe(false);
  });

  it("no modifica la credencial que se le pasa para firmar", async () => {
    const unsigned = sampleCredential(ctx);
    const before = structuredClone(unsigned);
    await signCredential({ credential: unsigned, keyRing: ctx.keyRing, documentLoader: ctx.documentLoader });
    expect(unsigned).toEqual(before);
  });

  it("alterar cualquier campo de la credencial firmada hace fallar la verificación", async () => {
    const paths = leafPaths(signed);
    expect(paths.length).toBeGreaterThan(25);
    const accepted: string[] = [];
    for (const path of paths) {
      const tampered = mutateAt(signed, path);
      const report = await verifyWith(ctx, tampered);
      if (report.verified) accepted.push(path.join("."));
    }
    expect(accepted).toEqual([]);
  }, 120_000);

  it("también falla si se añade un campo o se quita uno", async () => {
    const added = structuredClone(signed);
    (added.credentialSubject as Record<string, unknown>).description = "Matrícula de honor";
    expect((await verifyWith(ctx, added)).verified).toBe(false);

    const removed = structuredClone(signed);
    delete (removed.credentialSubject.achievement as Record<string, unknown>).image;
    expect((await verifyWith(ctx, removed)).verified).toBe(false);
  });

  it("rechaza una credencial caducada o que aún no es válida", async () => {
    const expiring = await issue(ctx, { validUntil: new Date("2026-12-31T23:59:59Z") });
    expect((await verifyWith(ctx, expiring, NOW)).verified).toBe(true);

    const expired = await verifyWith(ctx, expiring, new Date("2027-01-02T00:00:00Z"));
    expect(expired.verified).toBe(false);
    expect(expired.checks.validity.outcome).toBe("failed");
    expect(expired.checks.signature.outcome).toBe("passed");

    const early = await verifyWith(ctx, signed, new Date("2026-11-19T00:00:00Z"));
    expect(early.verified).toBe(false);
    expect(early.checks.validity.outcome).toBe("failed");
    expect(early.checks.signature.outcome).toBe("passed");
  });

  it("rechaza una credencial firmada con una clave que no está en el documento DID", async () => {
    // Alguien con otra clave se hace pasar por did:web:certificados.popiai.es.
    const impostor = await testIssuerContext(TEST_SEED_EVIL);
    const forged = await issue(impostor);
    expect(forged.issuer.id).toBe(ctx.did);

    const report = await verifyWith(ctx, forged);
    expect(report.verified).toBe(false);
    expect(report.checks.signature.outcome).toBe("failed");
  });

  it("rechaza credenciales de otro emisor", async () => {
    const other = await (await import("./issuer")).createIssuerContext({
      publicUrl: "https://otro-emisor.example",
      signingKeySeed: TEST_SEED_B,
      profile: { name: "Otro" },
    });
    const foreign = await issue(other, { issuer: other.profile });
    const report = await verifyWith(ctx, foreign);
    expect(report.verified).toBe(false);
    expect(report.checks.issuer.outcome).toBe("failed");
    expect(report.checks.signature.outcome).toBe("failed");
  });

  it("no firma credenciales a nombre de otro emisor", async () => {
    const credential = sampleCredential(ctx, { issuer: { id: "did:web:otro.example", name: "Otro" } });
    await expect(
      signCredential({ credential, keyRing: ctx.keyRing, documentLoader: ctx.documentLoader }),
    ).rejects.toThrow(/emisor/);
  });

  it("con credentialStatus no da por buena la credencial si no se puede comprobar el estado", async () => {
    const withStatus = await issue(ctx, {
      credentialStatus: {
        id: "https://certificados.popiai.es/status/1#94567",
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: "94567",
        statusListCredential: "https://certificados.popiai.es/status/1",
      },
    });
    const unchecked = await verifyWith(ctx, withStatus);
    expect(unchecked.verified).toBe(false);
    expect(unchecked.checks.signature.outcome).toBe("passed");
    expect(unchecked.checks.status.outcome).toBe("failed");

    const revoked = await verifyCredential({
      credential: withStatus,
      documentLoader: ctx.documentLoader,
      expectedIssuer: ctx.did,
      now: NOW,
      checkStatus: async () => ({ verified: false, message: "Revocada: error en el nombre" }),
    });
    expect(revoked.verified).toBe(false);
    expect(revoked.checks.status).toEqual({ outcome: "failed", message: "Revocada: error en el nombre" });

    const valid = await verifyCredential({
      credential: withStatus,
      documentLoader: ctx.documentLoader,
      expectedIssuer: ctx.did,
      now: NOW,
      checkStatus: async () => ({ verified: true }),
    });
    expect(valid.verified).toBe(true);
    expect(valid.checks.status.outcome).toBe("passed");
  });

  it("rechaza cosas que no son credenciales firmadas", async () => {
    expect((await verifyWith(ctx, null)).verified).toBe(false);
    expect((await verifyWith(ctx, "hola")).verified).toBe(false);
    expect((await verifyWith(ctx, sampleCredential(ctx))).verified).toBe(false);
  });
});

describe("rotación de claves", () => {
  it("lo firmado con la clave anterior sigue verificando tras rotar", async () => {
    const before = await testIssuerContext(TEST_SEED_A);
    const old = await issue(before);

    // Rotación: B pasa a ser la activa y A queda como retirada.
    const after = await testIssuerContext(TEST_SEED_B, [before.keyRing.active.publicKeyMultibase]);
    expect(after.didDocument.verificationMethod.map((vm) => vm.publicKeyMultibase)).toEqual([
      after.keyRing.active.publicKeyMultibase,
      before.keyRing.active.publicKeyMultibase,
    ]);

    expect((await verifyWith(after, old)).verified).toBe(true);

    const fresh = await issue(after);
    expect(fresh.proof!.verificationMethod).toContain(after.keyRing.active.publicKeyMultibase);
    expect((await verifyWith(after, fresh)).verified).toBe(true);
  });

  it("si la clave retirada se quita del documento DID, lo firmado con ella deja de verificar", async () => {
    const before = await testIssuerContext(TEST_SEED_A);
    const old = await issue(before);
    const forgotten = await testIssuerContext(TEST_SEED_B);
    expect((await verifyWith(forgotten, old)).verified).toBe(false);
  });
});

describe("cargador de documentos sin red", () => {
  it("solo resuelve los contextos empaquetados y el DID propio", async () => {
    const ctx = await testIssuerContext();
    const loader = createDocumentLoader([ctx.didDocument]);
    await expect(loader("https://www.w3.org/ns/credentials/v2")).resolves.toMatchObject({ document: expect.any(Object) });
    await expect(loader("https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json")).resolves.toBeTruthy();
    await expect(loader(ctx.did)).resolves.toMatchObject({ document: { id: ctx.did } });
    await expect(loader(ctx.didDocument.assertionMethod[0]!)).resolves.toMatchObject({
      document: { type: "Multikey", controller: ctx.did },
    });
    await expect(loader("https://example.com/context.json")).rejects.toThrow(/sin conexión/);
    await expect(loader("did:web:otro.example")).rejects.toThrow(/DID desconocido/);
    await expect(loader(`${ctx.did}#z6MkNoExiste`)).rejects.toThrow(/no publicada/);
  });
});
