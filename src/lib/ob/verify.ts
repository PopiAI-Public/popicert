import * as vc from "@digitalbazaar/vc";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import type { DocumentLoader } from "./document-loader";

export type CheckOutcome = "passed" | "failed" | "skipped";

export interface CheckResult {
  outcome: CheckOutcome;
  message?: string;
}

/** Resultado de la verificación, con cada comprobación por separado para mostrarlas en /verificar. */
export interface VerificationReport {
  verified: boolean;
  checks: {
    /** La firma es correcta y la clave está autorizada en el documento DID del emisor. */
    signature: CheckResult;
    /** El emisor es PopiCert. */
    issuer: CheckResult;
    /** Estamos dentro de validFrom / validUntil. */
    validity: CheckResult;
    /** No está revocada (Bitstring Status List). */
    status: CheckResult;
  };
}

export type StatusChecker = (credential: Record<string, unknown>) => Promise<{ verified: boolean; message?: string }>;

/** Margen de reloj que admite la librería vc (5 minutos). */
const MAX_CLOCK_SKEW_MS = 300_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issuerId(credential: Record<string, unknown>): string | undefined {
  const issuer = credential.issuer;
  if (typeof issuer === "string") return issuer;
  if (isObject(issuer) && typeof issuer.id === "string") return issuer.id;
  return undefined;
}

function checkValidity(credential: Record<string, unknown>, now: Date): CheckResult {
  const { validFrom, validUntil } = credential;
  if (typeof validFrom !== "string" || Number.isNaN(Date.parse(validFrom))) {
    return { outcome: "failed", message: "Falta validFrom o no es una fecha válida." };
  }
  if (Date.parse(validFrom) - MAX_CLOCK_SKEW_MS > now.getTime()) {
    return { outcome: "failed", message: `Todavía no es válida (desde ${validFrom}).` };
  }
  if (validUntil !== undefined) {
    if (typeof validUntil !== "string" || Number.isNaN(Date.parse(validUntil))) {
      return { outcome: "failed", message: "validUntil no es una fecha válida." };
    }
    if (Date.parse(validUntil) + MAX_CLOCK_SKEW_MS < now.getTime()) {
      return { outcome: "failed", message: `Caducó el ${validUntil}.` };
    }
  }
  return { outcome: "passed" };
}

function errorMessage(result: vc.VerifyResult): string {
  const error: (Error & { errors?: Error[] }) | undefined =
    result.error ?? result.results?.find((r) => r.error)?.error;
  if (!error) return "La firma no es válida.";
  const inner = error.errors?.[0];
  return (inner ?? error).message || "La firma no es válida.";
}

async function runVc(options: {
  credential: Record<string, unknown>;
  documentLoader: DocumentLoader;
  now: Date;
  checkStatus?: StatusChecker;
}): Promise<vc.VerifyResult> {
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  return vc.verifyCredential({
    credential: structuredClone(options.credential),
    suite,
    documentLoader: options.documentLoader,
    now: options.now,
    ...(options.checkStatus
      ? { checkStatus: async ({ credential }) => options.checkStatus!(credential) }
      : {}),
  });
}

/**
 * Verifica una credencial como lo haría un verificador externo (misma librería,
 * mismo algoritmo) y además desglosa qué ha fallado.
 *
 * Solo acepta credenciales de PopiCert: el cargador de documentos no conoce
 * otros DID y el emisor tiene que ser `expectedIssuer`.
 */
export async function verifyCredential(options: {
  credential: unknown;
  documentLoader: DocumentLoader;
  expectedIssuer: string;
  now?: Date;
  checkStatus?: StatusChecker;
}): Promise<VerificationReport> {
  const now = options.now ?? new Date();
  const skipped: CheckResult = { outcome: "skipped" };

  if (!isObject(options.credential) || !isObject(options.credential.proof)) {
    return {
      verified: false,
      checks: {
        signature: { outcome: "failed", message: "No es una credencial firmada." },
        issuer: skipped,
        validity: skipped,
        status: skipped,
      },
    };
  }
  const credential = options.credential;

  const foundIssuer = issuerId(credential);
  const issuer: CheckResult =
    foundIssuer === options.expectedIssuer
      ? { outcome: "passed" }
      : { outcome: "failed", message: `Emisor desconocido: ${foundIssuer ?? "(ninguno)"}.` };

  const validity = checkValidity(credential, now);
  const hasStatus = credential.credentialStatus !== undefined;

  // 1) Verificación completa, igual que un verificador externo.
  const full = await runVc({
    credential,
    documentLoader: options.documentLoader,
    now,
    checkStatus: options.checkStatus,
  });

  if (full.verified && issuer.outcome === "passed" && validity.outcome === "passed") {
    return {
      verified: true,
      checks: {
        signature: { outcome: "passed" },
        issuer,
        validity,
        status: hasStatus ? { outcome: "passed" } : skipped,
      },
    };
  }

  // 2) Algo ha fallado: aislamos la firma verificándola en un instante dentro de
  //    su periodo de validez y sin comprobar el estado. Las fechas y el estado se
  //    evalúan aparte, así que esto no relaja ninguna comprobación.
  let signature: CheckResult;
  let status: CheckResult = skipped;
  if (full.verified) {
    signature = { outcome: "passed" };
    status = hasStatus ? { outcome: "passed" } : skipped;
  } else if (full.statusResult && !full.statusResult.verified) {
    signature = { outcome: "passed" };
    const message = typeof full.statusResult.message === "string" ? full.statusResult.message : "Revocada.";
    status = { outcome: "failed", message };
  } else {
    // `credentialStatus` forma parte de lo firmado, así que no se puede quitar:
    // se usa un comprobador de estado neutro solo para aislar la firma.
    const validFrom = typeof credential.validFrom === "string" ? Date.parse(credential.validFrom) : NaN;
    const signatureOnly = await runVc({
      credential,
      documentLoader: options.documentLoader,
      now: Number.isNaN(validFrom) ? now : new Date(validFrom),
      checkStatus: hasStatus ? async () => ({ verified: true }) : undefined,
    });
    signature = signatureOnly.verified
      ? { outcome: "passed" }
      : { outcome: "failed", message: errorMessage(signatureOnly) };

    if (hasStatus && !options.checkStatus) {
      status = { outcome: "failed", message: "No se puede comprobar el estado de revocación." };
    } else if (hasStatus && options.checkStatus && signature.outcome === "passed") {
      const result = await options.checkStatus(credential);
      status = result.verified
        ? { outcome: "passed" }
        : { outcome: "failed", message: result.message ?? "Revocada." };
    }
  }

  return { verified: false, checks: { signature, issuer, validity, status } };
}
