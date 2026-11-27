// Revocación con Bitstring Status List contra una PostgreSQL real (KAN-10).
import { decodeList } from "@digitalbazaar/vc-bitstring-status-list";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// randomInt real, pero espiable, para poder forzar colisiones de índice.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
const { randomInt } = await import("node:crypto");
import type { IssuerContext } from "@/lib/ob/issuer";
import { signCredential } from "@/lib/ob/sign";
import { sampleCredential, testIssuerContext } from "@/lib/ob/testing";
import { verifyCredential } from "@/lib/ob/verify";
import { createStatusChecker, STATUS_LIST_SIZE } from "@/lib/status/status-list";

const url = process.env.DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("En la CI los tests de integración necesitan DATABASE_URL.");
}

describe.skipIf(!url)("revocación con Bitstring Status List", async () => {
  const { getPrisma } = await import("@/lib/db");
  const {
    allocateStatusEntry,
    createStatusAwareDocumentLoader,
    getStatusListCredential,
    revokeStatusEntry,
    StatusEntryNotFoundError,
  } = await import("@/lib/status/repository");
  const prisma = getPrisma();
  let issuer: IssuerContext;

  beforeAll(async () => {
    issuer = await testIssuerContext();
  });

  beforeEach(async () => {
    // Base de datos de estado vacía en cada test.
    await prisma.$executeRawUnsafe("TRUNCATE status_entry, status_list RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe("TRUNCATE status_entry, status_list RESTART IDENTITY CASCADE");
    await prisma.$disconnect();
  });

  async function emit() {
    const allocated = await allocateStatusEntry(prisma, issuer);
    const loader = createStatusAwareDocumentLoader(prisma, issuer);
    const credential = await signCredential({
      credential: sampleCredential(issuer, { credentialStatus: allocated.credentialStatus }),
      keyRing: issuer.keyRing,
      documentLoader: loader,
    });
    return { allocated, credential };
  }

  function verify(credential: unknown) {
    const loader = createStatusAwareDocumentLoader(prisma, issuer);
    return verifyCredential({
      credential,
      documentLoader: loader,
      expectedIssuer: issuer.did,
      checkStatus: createStatusChecker(loader),
    });
  }

  it("emitir, verificar (válido), revocar y verificar (revocado)", async () => {
    const { allocated, credential } = await emit();
    expect(credential.credentialStatus).toEqual({
      id: `https://certificados.popiai.es/status/1#${allocated.index}`,
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: String(allocated.index),
      statusListCredential: "https://certificados.popiai.es/status/1",
    });

    const before = await verify(credential);
    expect(before.verified).toBe(true);
    expect(before.checks.status.outcome).toBe("passed");

    const issued = structuredClone(credential);
    const result = await revokeStatusEntry(prisma, issuer, { entryId: allocated.entryId, reason: "Error en el nombre" });
    expect(result.alreadyRevoked).toBe(false);

    const after = await verify(credential);
    expect(after.verified).toBe(false);
    expect(after.checks.signature.outcome).toBe("passed");
    expect(after.checks.status).toEqual({ outcome: "failed", message: "Revocada." });

    // Revocar no modifica la credencial ya emitida: sigue siendo exactamente la misma.
    expect(credential).toEqual(issued);

    const entry = await prisma.statusEntry.findUniqueOrThrow({ where: { id: allocated.entryId } });
    expect(entry.revocationReason).toBe("Error en el nombre");
    expect(entry.revokedAt).toBeInstanceOf(Date);
  });

  it("revocar una no afecta a las demás", async () => {
    const a = await emit();
    const b = await emit();
    await revokeStatusEntry(prisma, issuer, { entryId: a.allocated.entryId, reason: "Duplicado" });
    expect((await verify(a.credential)).verified).toBe(false);
    expect((await verify(b.credential)).verified).toBe(true);
  });

  it("N emisiones simultáneas reciben N índices distintos, que no siguen el orden de emisión", async () => {
    const N = 60;
    const results = await Promise.all(Array.from({ length: N }, () => allocateStatusEntry(prisma, issuer)));
    const indices = results.map((r) => r.index);
    expect(new Set(indices).size).toBe(N);
    expect(new Set(results.map((r) => r.entryId)).size).toBe(N);
    expect(results.every((r) => r.listId === 1)).toBe(true);
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(STATUS_LIST_SIZE);
    }
    // En orden de creación, los índices no van ni consecutivos ni crecientes.
    const stored = await prisma.statusEntry.findMany({ orderBy: { createdAt: "asc" }, select: { index: true } });
    const sorted = [...stored.map((s) => s.index)].sort((x, y) => x - y);
    expect(stored.map((s) => s.index)).not.toEqual(sorted);
    expect(await prisma.statusList.count()).toBe(1);
  });

  it("si el índice aleatorio ya está cogido, prueba otro", async () => {
    const mocked = vi.mocked(randomInt as (max: number) => number);
    mocked.mockReturnValueOnce(1234);
    const first = await allocateStatusEntry(prisma, issuer);
    mocked.mockReturnValueOnce(1234).mockReturnValueOnce(1234).mockReturnValueOnce(5678);
    const second = await allocateStatusEntry(prisma, issuer);
    expect(first.index).toBe(1234);
    expect(second.index).toBe(5678);
  });

  it("revocaciones simultáneas en la misma lista no se pisan", async () => {
    const entries = await Promise.all(Array.from({ length: 8 }, () => allocateStatusEntry(prisma, issuer)));
    await Promise.all(
      entries.map((e) => revokeStatusEntry(prisma, issuer, { entryId: e.entryId, reason: "Prueba de concurrencia" })),
    );
    const list = await getStatusListCredential(prisma, 1);
    const decoded = await decodeList({ encodedList: (list!.credentialSubject as { encodedList: string }).encodedList });
    expect(entries.map((e) => decoded.getStatus(e.index))).toEqual(entries.map(() => true));
    const row = await prisma.statusList.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.version).toBe(1 + entries.length);
  });

  it("revocar dos veces no cambia el motivo ni la fecha originales", async () => {
    const { allocated } = await emit();
    const first = await revokeStatusEntry(prisma, issuer, { entryId: allocated.entryId, reason: "Primero" });
    const second = await revokeStatusEntry(prisma, issuer, { entryId: allocated.entryId, reason: "Segundo" });
    expect(second).toEqual({ revokedAt: first.revokedAt, reason: "Primero", alreadyRevoked: true });
  });

  it("revocar exige motivo y una entrada que exista", async () => {
    const { allocated } = await emit();
    await expect(revokeStatusEntry(prisma, issuer, { entryId: allocated.entryId, reason: "  " })).rejects.toThrow(/motivo/);
    await expect(
      revokeStatusEntry(prisma, issuer, { entryId: "00000000-0000-4000-8000-000000000000", reason: "x" }),
    ).rejects.toBeInstanceOf(StatusEntryNotFoundError);
  });

  it("la lista publicada verifica con su firma, antes y después de revocar", async () => {
    const { allocated } = await emit();
    const loader = createStatusAwareDocumentLoader(prisma, issuer);
    const check = async () =>
      verifyCredential({
        credential: await getStatusListCredential(prisma, 1),
        documentLoader: loader,
        expectedIssuer: issuer.did,
      });
    expect((await check()).verified).toBe(true);
    await revokeStatusEntry(prisma, issuer, { entryId: allocated.entryId, reason: "Prueba" });
    expect((await check()).verified).toBe(true);
  });

  it("GET /status/1 publica la lista con caché, y 404 para listas que no existen", async () => {
    await emit();
    const { GET } = await import("@/app/status/[id]/route");
    const call = (id: string) => GET(new Request(`http://localhost/status/${id}`), { params: Promise.resolve({ id }) });

    const response = await call("1");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await response.json();
    expect(body.type).toEqual(["VerifiableCredential", "BitstringStatusListCredential"]);
    expect(body).toEqual(await getStatusListCredential(prisma, 1));

    expect((await call("2")).status).toBe(404);
    expect((await call("abc")).status).toBe(404);
    expect((await call("0")).status).toBe(404);
  });
});
