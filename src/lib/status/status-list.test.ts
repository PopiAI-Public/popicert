import { decodeList } from "@digitalbazaar/vc-bitstring-status-list";
import { beforeAll, describe, expect, it } from "vitest";
import { createDocumentLoader } from "../ob/document-loader";
import type { IssuerContext } from "../ob/issuer";
import { signCredential } from "../ob/sign";
import { sampleCredential, TEST_SEED_B, TEST_SEED_EVIL, testIssuerContext } from "../ob/testing";
import { verifyCredential } from "../ob/verify";
import {
  buildSignedStatusList,
  createStatusChecker,
  credentialStatusEntry,
  parseStatusListUrl,
  STATUS_LIST_SIZE,
  statusListUrl,
} from "./status-list";

const PUBLIC_URL = "https://certificados.popiai.es";
const LIST_URL = `${PUBLIC_URL}/status/1`;
const NOW = new Date("2026-11-27T10:00:00Z");

describe("URLs y entradas de estado", () => {
  it("construye y reconoce la URL de la lista", () => {
    expect(statusListUrl(PUBLIC_URL, 1)).toBe(LIST_URL);
    expect(statusListUrl(`${PUBLIC_URL}/`, 2)).toBe(`${PUBLIC_URL}/status/2`);
    expect(() => statusListUrl(PUBLIC_URL, 0)).toThrow();
    expect(parseStatusListUrl(PUBLIC_URL, LIST_URL)).toBe(1);
    expect(parseStatusListUrl(PUBLIC_URL, `${PUBLIC_URL}/status/01`)).toBeNull();
    expect(parseStatusListUrl(PUBLIC_URL, `${PUBLIC_URL}/status/1/../x`)).toBeNull();
    expect(parseStatusListUrl(PUBLIC_URL, "https://otro.example/status/1")).toBeNull();
  });

  it("la entrada es un BitstringStatusListEntry de revocación con el índice como texto", () => {
    expect(credentialStatusEntry(LIST_URL, 94567)).toEqual({
      id: `${LIST_URL}#94567`,
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "94567",
      statusListCredential: LIST_URL,
    });
    expect(() => credentialStatusEntry(LIST_URL, STATUS_LIST_SIZE)).toThrow();
    expect(() => credentialStatusEntry(LIST_URL, -1)).toThrow();
  });
});

describe("lista de estado firmada", () => {
  let issuer: IssuerContext;
  beforeAll(async () => {
    issuer = await testIssuerContext();
  });

  it("es una BitstringStatusListCredential firmada de 131.072 entradas con los bits revocados", async () => {
    const list = await buildSignedStatusList({ issuer, listId: 1, revokedIndices: [0, 7, 131_071], date: NOW });
    expect(list).toMatchObject({
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      id: LIST_URL,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: issuer.did,
      validFrom: "2026-11-27T10:00:00Z",
      credentialSubject: { id: `${LIST_URL}#list`, type: "BitstringStatusList", statusPurpose: "revocation" },
      proof: { cryptosuite: "eddsa-rdfc-2022" },
    });
    const decoded = await decodeList({ encodedList: (list.credentialSubject as { encodedList: string }).encodedList });
    expect(decoded.length).toBe(STATUS_LIST_SIZE);
    expect([0, 7, 131_071].map((i) => decoded.getStatus(i))).toEqual([true, true, true]);
    expect([1, 6, 8, 65_536, 131_070].map((i) => decoded.getStatus(i))).toEqual([false, false, false, false, false]);

    // La lista verifica con su firma.
    const report = await verifyCredential({
      credential: list,
      documentLoader: issuer.documentLoader,
      expectedIssuer: issuer.did,
      now: NOW,
    });
    expect(report.verified).toBe(true);
  });

  it("no admite listas más pequeñas que el mínimo", async () => {
    await expect(buildSignedStatusList({ issuer, listId: 1, revokedIndices: [], size: 1024 })).rejects.toThrow(/mínimo/);
  });
});

describe("comprobador de estado", () => {
  let issuer: IssuerContext;
  beforeAll(async () => {
    issuer = await testIssuerContext();
  });

  async function setup(revokedIndices: number[], listOverride?: (list: Record<string, unknown>) => Record<string, unknown>) {
    let list = await buildSignedStatusList({ issuer, listId: 1, revokedIndices, date: NOW });
    if (listOverride) list = listOverride(list);
    const loader = createDocumentLoader([issuer.didDocument], async (url) => (url === LIST_URL ? list : undefined));
    const credential = await signCredential({
      credential: sampleCredential(issuer, { credentialStatus: credentialStatusEntry(LIST_URL, 42) }),
      keyRing: issuer.keyRing,
      documentLoader: loader,
    });
    const verify = () =>
      verifyCredential({
        credential,
        documentLoader: loader,
        expectedIssuer: issuer.did,
        now: NOW,
        checkStatus: createStatusChecker(loader),
      });
    return { credential, verify };
  }

  it("da por válida una credencial cuyo bit está a 0", async () => {
    const { verify } = await setup([41, 43]);
    const report = await verify();
    expect(report.verified).toBe(true);
    expect(report.checks.status).toEqual({ outcome: "passed" });
  });

  it("da por revocada una credencial cuyo bit está a 1", async () => {
    const { verify } = await setup([42]);
    const report = await verify();
    expect(report.verified).toBe(false);
    expect(report.checks.signature.outcome).toBe("passed");
    expect(report.checks.status).toEqual({ outcome: "failed", message: "Revocada." });
  });

  it("no se fía de una lista manipulada: si alguien pone el bit a 0, la firma de la lista falla", async () => {
    const realRevoked = await buildSignedStatusList({ issuer, listId: 1, revokedIndices: [42], date: NOW });
    const cleanList = await buildSignedStatusList({ issuer, listId: 1, revokedIndices: [], date: NOW });
    const { verify } = await setup([], () => ({
      ...realRevoked,
      credentialSubject: cleanList.credentialSubject,
    }));
    const report = await verify();
    expect(report.verified).toBe(false);
    expect(report.checks.status.outcome).toBe("failed");
    expect(report.checks.status.message).toMatch(/No se pudo comprobar/);
  });

  it("no acepta una lista firmada por otra clave", async () => {
    const impostor = await testIssuerContext(TEST_SEED_EVIL);
    const forgedList = await buildSignedStatusList({ issuer: impostor, listId: 1, revokedIndices: [], date: NOW });
    const { verify } = await setup([], () => forgedList);
    const report = await verify();
    expect(report.verified).toBe(false);
    expect(report.checks.status.outcome).toBe("failed");
  });

  it("no acepta una lista de otro emisor", async () => {
    const other = await (await import("../ob/issuer")).createIssuerContext({
      publicUrl: "https://otro-emisor.example",
      signingKeySeed: TEST_SEED_B,
      profile: { name: "Otro" },
    });
    const foreign = await buildSignedStatusList({ issuer: other, listId: 1, revokedIndices: [], date: NOW });
    const { verify } = await setup([], () => foreign);
    expect((await verify()).verified).toBe(false);
  });

  it("si la lista no se puede cargar, no da la credencial por válida", async () => {
    const loader = createDocumentLoader([issuer.didDocument]);
    const credential = await signCredential({
      credential: sampleCredential(issuer, { credentialStatus: credentialStatusEntry(LIST_URL, 42) }),
      keyRing: issuer.keyRing,
      documentLoader: loader,
    });
    const report = await verifyCredential({
      credential,
      documentLoader: loader,
      expectedIssuer: issuer.did,
      now: NOW,
      checkStatus: createStatusChecker(loader),
    });
    expect(report.verified).toBe(false);
    expect(report.checks.status.outcome).toBe("failed");
  });
});
