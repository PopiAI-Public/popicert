import { describe, expect, it } from "vitest";
import { buildOpenBadgeCredential } from "@/lib/ob/credential";
import { sampleCredentialInput, testIssuerContext } from "@/lib/ob/testing";
import { certificatePageCode, isCertificatePath, wantsJson } from "@/lib/security/paths";
import { credentialFields, linkedInUrl } from "./certificate";

describe("negociación de contenido de /c/<código>", () => {
  it("da JSON a quien lo pide y HTML a los navegadores", () => {
    expect(wantsJson("application/ld+json")).toBe(true);
    expect(wantsJson("application/json")).toBe(true);
    expect(wantsJson("application/ld+json, application/json;q=0.9, */*;q=0.1")).toBe(true);
    // Lo que manda un navegador.
    expect(wantsJson("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(wantsJson("*/*")).toBe(false);
    expect(wantsJson(null)).toBe(false);
    expect(wantsJson("text/html;q=0.5, application/json")).toBe(true);
    expect(wantsJson("application/json;q=0.2, text/html")).toBe(false);
  });

  it("solo la URL exacta del certificado", () => {
    expect(certificatePageCode("/c/ABCD234567")).toBe("ABCD234567");
    expect(certificatePageCode("/c/ABCD234567/")).toBe("ABCD234567");
    expect(certificatePageCode("/c/ABCD234567/certificado.pdf")).toBeNull();
    expect(certificatePageCode("/verificar")).toBeNull();
    expect(isCertificatePath("/C/abc")).toBe(true);
    expect(isCertificatePath("/x/../c/abc")).toBe(true);
  });
});

describe("campos públicos de la credencial", async () => {
  const ctx = await testIssuerContext();

  it("salen de result + resultDescription, en orden", () => {
    const credential = buildOpenBadgeCredential(sampleCredentialInput(ctx));
    expect(credentialFields(credential)).toEqual([
      { label: "Horas", value: "8" },
      { label: "Lugar", value: "Valencia" },
    ]);
  });

  it("sin campos, ni result ni resultDescription", () => {
    const credential = buildOpenBadgeCredential(sampleCredentialInput(ctx, { fields: [{ key: "lugar", label: "Lugar", value: "  " }] }));
    expect(credentialFields(credential)).toEqual([]);
    expect(JSON.stringify(credential)).not.toContain("resultDescription");
  });

  it("ignora lo que no cuadra en una credencial manipulada", () => {
    expect(credentialFields({ credentialSubject: { result: [{ resultDescription: "x", value: "y" }], achievement: {} } })).toEqual([]);
    expect(credentialFields({})).toEqual([]);
  });
});

describe("Añadir a LinkedIn", () => {
  it("lleva la organización, el nombre, la fecha en hora de Madrid y la URL del certificado", () => {
    const url = new URL(
      linkedInUrl(
        {
          achievement: { name: "IA generativa & pymes", description: "", criteria: "", image: null },
          // 31 de diciembre a las 23:30 UTC ya es 1 de enero en Madrid.
          issuedAt: new Date("2026-12-31T23:30:00Z"),
          url: "https://certificados.popiai.es/c/ABCD234567",
          code: "ABCD234567",
        },
        "109129476",
      ),
    );
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/profile/add");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      startTask: "CERTIFICATION_NAME",
      name: "IA generativa & pymes",
      organizationId: "109129476",
      issueYear: "2027",
      issueMonth: "1",
      certUrl: "https://certificados.popiai.es/c/ABCD234567",
      certId: "ABCD234567",
    });
  });
});
