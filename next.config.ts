import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Las librerías de firma de Digital Bazaar y el driver de PostgreSQL se cargan
  // tal cual desde node_modules en el servidor, sin empaquetar.
  serverExternalPackages: [
    "@digitalbazaar/vc",
    "@digitalbazaar/data-integrity",
    "@digitalbazaar/eddsa-rdfc-2022-cryptosuite",
    "@digitalbazaar/ed25519-multikey",
    "jsonld",
    "jsonld-signatures",
    "pg",
  ],
};

export default nextConfig;
