import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las respuestas. HSTS lo pone Cloudflare.
 *
 * La CSP no permite nada externo: ni scripts, ni estilos, ni imágenes de otros
 * dominios, ni que la web se meta en un iframe. `unsafe-inline` en scripts y
 * estilos lo necesita Next.js para hidratar sin nonces; como no se carga nada
 * de fuera y no hay contenido de usuarios sin escapar, el riesgo es bajo.
 * `unsafe-eval` solo en desarrollo, para la recarga en caliente.
 */
const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No se usa next/image: sin esto, /_next/image sería un endpoint público que
  // gasta CPU redimensionando imágenes sin límite de peticiones.
  images: { unoptimized: true },
  // Las librerías de firma de Digital Bazaar y el driver de PostgreSQL se cargan
  // tal cual desde node_modules en el servidor, sin empaquetar.
  serverExternalPackages: [
    "@digitalbazaar/vc",
    "@digitalbazaar/data-integrity",
    "@digitalbazaar/eddsa-rdfc-2022-cryptosuite",
    "@digitalbazaar/ed25519-multikey",
    "@digitalbazaar/vc-bitstring-status-list",
    "jsonld",
    "jsonld-signatures",
    "pg",
    // PDFKit lee del disco los datos de las fuentes estándar: sin empaquetar.
    "pdfkit",
    "svg-to-pdfkit",
    "fontkit",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
