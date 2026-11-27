import { randomInt } from "node:crypto";

/**
 * Alfabeto de los códigos de certificado: sin caracteres que se confundan al
 * leerlos o dictarlos (0/O, 1/I/L). 31 símbolos.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 10;

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * Código aleatorio de 10 caracteres (unos 49 bits), con el generador
 * criptográfico y sin sesgo de módulo. No se puede adivinar ni recorrer.
 */
export function generateCertificateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Normaliza lo que escribe una persona (minúsculas, espacios, guiones) y valida el formato. */
export function normalizeCertificateCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE_PATTERN.test(code) ? code : null;
}
