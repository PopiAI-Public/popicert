/**
 * Textos de la parte pública. Solo español por ahora; para añadir inglés basta
 * con otro objeto con la misma forma y elegirlo (por ejemplo con `?lang=en` o
 * `Accept-Language`).
 */
export const es = {
  lang: "es-ES",
  siteName: "Certificados de PopiAI",
  valid: "Certificado válido",
  revoked: "Certificado revocado",
  revokedOn: (date: string) => `Revocado el ${date}.`,
  reason: "Motivo",
  completed: "ha completado",
  issuedBy: "Emitido por",
  issuedOn: "Fecha de emisión",
  code: "Código",
  criteria: "Criterios",
  details: "Detalles",
  downloadPdf: "Descargar el PDF",
  downloadJson: "Descargar la credencial (JSON)",
  addToLinkedIn: "Añadir a LinkedIn",
  verify: "Comprobar la firma",
  qrAlt: "Código QR con el enlace a este certificado",
  aboutTitle: "Qué es esto",
  about:
    "Es una credencial verificable Open Badges 3.0, firmada digitalmente. Cualquiera puede comprobar en /verificar, o con un verificador externo de Open Badges, que la emitió PopiAI y que no se ha modificado.",
  hiddenTitle: "Certificado no público",
  hidden: "Este certificado existe, pero su titular ha pedido que no se muestre. Si tienes la credencial (JSON), puedes comprobarla en la página de verificación.",
  notFoundTitle: "Certificado no encontrado",
  notFound: "No hay ningún certificado con ese código. Revisa que esté bien escrito.",
  verifyTitle: "Verificar un certificado",
  verifyIntro: "Escribe el código del certificado o sube su credencial en JSON para comprobar que la emitió PopiAI, que no se ha modificado y que no está revocada.",
  verifyByCode: "Por código",
  verifyByFile: "Subiendo la credencial (JSON)",
  codePlaceholder: "Por ejemplo ABCD-234567",
  check: "Comprobar",
  checking: "Comprobando…",
  verified: "La credencial es auténtica y está en vigor.",
  notVerified: "La credencial no supera todas las comprobaciones.",
  checks: { signature: "Firma digital", issuer: "Emisor", validity: "Vigencia", status: "Revocación" },
  outcome: { passed: "Correcto", failed: "Falla", skipped: "No aplica" },
  viewCertificate: "Ver el certificado",
  privacy:
    "Esta página muestra el nombre del titular y la formación para que se pueda compartir y comprobar. Si eres el titular y prefieres que no sea pública, escribe a info@popiai.es.",
} as const;

export type Messages = typeof es;

export const messages: Messages = es;

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" });

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}
