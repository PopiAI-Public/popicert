import { adminHandler } from "@/lib/security/access";

export const dynamic = "force-dynamic";

/** Quién soy en el admin. Sirve para comprobar que Cloudflare Access está bien configurado. */
export const GET = adminHandler(async (_request, _context, admin) =>
  Response.json({ email: admin.email }, { headers: { "Cache-Control": "no-store" } }),
);
