// Genera una clave de firma nueva para PopiCert.
//
//   npm run keygen -- https://certificados.popiai.es
//
// Imprime la semilla (SECRETA: va al secreto del despliegue y al gestor de
// contraseñas) y la clave pública (no secreta: hay que anotarla para cuando se
// retire). Ver docs/rotacion-de-claves.md.
import { didWebFromUrl } from "../src/lib/ob/did";
import { generateSigningKeySeed, keyPairFromSeed } from "../src/lib/ob/keys";

const publicUrl = process.argv[2] ?? process.env.PUBLIC_URL ?? "https://certificados.popiai.es";
const did = didWebFromUrl(publicUrl);
const seed = generateSigningKeySeed();
const keyPair = await keyPairFromSeed(did, seed);

console.log(`DID:             ${did}`);
console.log(`Clave pública:   ${keyPair.publicKeyMultibase}`);
console.log(`Id de la clave:  ${keyPair.id}`);
console.log("");
console.log("Semilla privada (POPICERT_SIGNING_KEY). Guárdala en el secreto del despliegue");
console.log("y en el gestor de contraseñas. No la pegues en ningún otro sitio:");
console.log("");
console.log(seed);
