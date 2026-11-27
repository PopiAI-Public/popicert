# Seguridad de PopiCert

Lo que hay que proteger: **que nadie pueda emitir, revocar ni editar
certificados en nombre de PopiAI**, y los datos de los asistentes. Fue lo que
hizo descartar Certo, así que cada barrera tiene tests.

## Barreras

### 1. Sin cuentas de usuario

No hay registro ni login propio. La única forma de escribir es el panel de
administración, en un host aparte (`ADMIN_HOST`, por ejemplo
`certificados-admin.luismi.dev`) protegido con Cloudflare Access: solo los
emails de `ADMIN_EMAILS`, con PIN por email.

### 2. El admin no existe en el host público

`src/proxy.ts` responde 404 a `/admin` y `/api/admin` en cualquier host que no
sea `ADMIN_HOST`, con cualquier método. La ruta se normaliza antes (`%61dmin`,
`//admin`, `/x/../admin`, mayúsculas) y `X-Forwarded-Host` se ignora. La
configuración no deja que `ADMIN_HOST` coincida con el host público.

### 3. La app valida el JWT de Access

En el host de admin, **todas** las peticiones necesitan la cabecera
`Cf-Access-Jwt-Assertion` con un JWT que la app valida ella misma; no se fía de
que el proxy de Cloudflare esté delante:

- firma RS256 con las claves públicas del equipo de Access
  (`https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs`);
- emisor = el equipo, audiencia = la aplicación (`CF_ACCESS_AUD`);
- sin caducar (con 30 s de margen de reloj);
- email dentro de `ADMIN_EMAILS`.

Sin token válido, 403, aunque la petición llegue por la red interna. Si Access
no está configurado, **nadie** entra.

### 4. Segunda comprobación en cada handler

El proxy no es la única barrera. Cada handler de `/api/admin` va envuelto en
`adminHandler`, y cada página del admin llama a `authenticateAdmin`, que vuelven
a comprobar host y token. `tests/routes-structure.test.ts` obliga a que:

- las rutas que escriben (`POST`, `PUT`, `PATCH`, `DELETE`) solo existan bajo `/api/admin`;
- todos los handlers de `/api/admin` usen `adminHandler`;
- las Server Actions solo existan en el admin y autentiquen;
- las páginas del admin autentiquen.

### 5. Parte pública de solo lectura

- Límite de 30 peticiones por minuto e IP en `/verificar` (la IP la da
  `CF-Connecting-IP`; el servidor solo es accesible por el túnel de Cloudflare).
- Cabeceras de seguridad en todas las respuestas: CSP sin recursos externos,
  `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  HSTS lo pone Cloudflare.
- Los códigos de certificado son aleatorios (unos 49 bits) y no hay listados que
  permitan recorrerlos.

### 6. La clave de firma

- Solo en el secreto del despliegue (`POPICERT_SIGNING_KEY`) y en el gestor de
  contraseñas. Nunca en la base de datos, en el repo ni en los logs: los errores
  de configuración dicen qué variable falla, no su valor.
- Las claves públicas tampoco están en la base de datos: con acceso de escritura
  a la base de datos no se puede añadir una clave al documento DID.
- Rotación: `docs/rotacion-de-claves.md`.

## Desarrollo en local

Con `next dev`, `DEV_ADMIN_EMAIL` permite entrar en el admin sin Cloudflare
Access, poniendo `ADMIN_HOST` a, por ejemplo, `admin.localhost:3000`. Fuera de
`next dev` (en la imagen, `NODE_ENV=production`) se ignora, y hay un test que lo
comprueba.

## Pendiente

- [ ] Revisión de seguridad del repo antes de la primera emisión real (KAN-15).
- [ ] Ocultar un certificado a petición del asistente (KAN-11 y KAN-12).
- [ ] Que los campos privados de la plantilla, como el DNI, no salgan nunca en la
      credencial ni en la página (KAN-13 y KAN-12).
- [ ] Texto de privacidad revisado: borrador en `docs/privacidad.md`.
