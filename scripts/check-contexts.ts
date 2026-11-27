// Comprueba que los contextos JSON-LD empaquetados son idénticos a los que se
// publican en sus URLs. Es el único sitio donde PopiCert descarga contextos, y
// solo se ejecuta a mano o en la CI, nunca al firmar ni al verificar.
//
//   npm run check-contexts
import { isDeepStrictEqual } from "node:util";
import { STATIC_CONTEXTS } from "../src/lib/ob/contexts";

let failed = false;
for (const [url, local] of STATIC_CONTEXTS) {
  try {
    const response = await fetch(url, { headers: { accept: "application/ld+json, application/json" }, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    const same = isDeepStrictEqual(remote, local);
    console.log(`${same ? "OK  " : "DIFF"} ${url}`);
    if (!same) failed = true;
  } catch (error) {
    console.log(`ERR  ${url}: ${(error as Error).message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
