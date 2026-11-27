// Emite una credencial de ejemplo firmada con una clave de usar y tirar y la
// imprime en JSON, para probarla en validadores externos (por ejemplo, el de
// Open Badges 3.0 de 1EdTech).
//
//   npm run sample-credential > ejemplo.json
//
// Ojo: la clave es aleatoria y el DID no se puede resolver, así que un validador
// externo podrá comprobar la estructura, pero no la firma. La firma se valida en
// producción (KAN-17).
import { generateSigningKeySeed } from "../src/lib/ob/keys";
import { signCredential } from "../src/lib/ob/sign";
import { sampleCredential, testIssuerContext } from "../src/lib/ob/testing";

const ctx = await testIssuerContext(generateSigningKeySeed());
const signed = await signCredential({
  credential: sampleCredential(ctx, { validFrom: new Date() }),
  keyRing: ctx.keyRing,
  documentLoader: ctx.documentLoader,
});
console.log(JSON.stringify(signed, null, 2));
