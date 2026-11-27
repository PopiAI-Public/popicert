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

### 7. Las plantillas son contenido no fiable

Un SVG puede llevar scripts, cargar recursos de fuera o, en el generador de PDF,
leer ficheros del disco. Por eso:

- Al subirlo se sanea con una lista de lo permitido (`src/lib/templates/sanitize.ts`):
  fuera `<script>`, atributos `on…`, `foreignObject`, animaciones, enlaces,
  `href` que no sean a `#id` del propio SVG o imágenes PNG/JPEG incrustadas, y
  CSS con `@import`, `@font-face`, `url()` externas o escapes. Un SVG con
  `DOCTYPE` o entidades (XXE, «bomba de mil millones de risas») se rechaza.
- Se vuelve a sanear cada vez que se genera un PDF, por si alguien tocara la
  base de datos.
- El generador de PDF no puede abrir ficheros ni URLs: las imágenes solo se
  aceptan incrustadas y las fuentes solo las subidas o las estándar del PDF.
- Los datos (nombres, etc.) entran en el árbol XML como texto, nunca pegados en
  el SVG: un nombre con `<script>` sale escrito tal cual en el diploma.
- La vista previa SVG se sirve con `Content-Security-Policy: default-src 'none';
  sandbox`, por si alguien la abre directamente.
- Límites de tamaño: 10 MB por subida, 5 MB el SVG, 12 fuentes.
- Una versión usada en certificados no se puede modificar ni borrar: lo impiden
  triggers de PostgreSQL, no solo la aplicación.

### 8. Lo emitido no cambia

- Un certificado guarda la credencial firmada y los datos con los que se genera
  su PDF. Un trigger de PostgreSQL impide modificarlos, y deshacer una
  revocación. Solo se puede revocar (una vez) y ocultar o volver a mostrar.
- Una formación con certificados no se puede borrar (clave ajena `RESTRICT`).
- Los campos privados de la plantilla, como el DNI, solo se guardan para el
  PDF: nunca entran en la credencial firmada. El email va en ella con hash y sal.
- Las imágenes de las insignias se publican por su sha256: la que enlaza una
  credencial emitida no se puede sustituir. Solo se aceptan PNG y JPEG,
  comprobados por su contenido.
- Las exportaciones a CSV neutralizan las fórmulas (`=`, `+`, `-`, `@`) para
  que una celda no se ejecute al abrirla en Excel.
- Cada acción del admin (crear, editar, archivar o borrar formaciones, emitir,
  revocar, ocultar) queda en `audit_log` en la misma transacción, con el email
  del JWT de Access. Se consulta en `/admin/auditoria`.

`tests/issuance-api.integration.test.ts` llama a **todos** los handlers del
admin de formaciones y certificados sin JWT, con un JWT caducado, con otra
audiencia y con un email no permitido, y comprueba que todos dan 403 y que no
se escribe nada.

## Desarrollo en local

Con `next dev`, `DEV_ADMIN_EMAIL` permite entrar en el admin sin Cloudflare
Access, poniendo `ADMIN_HOST` a, por ejemplo, `admin.localhost:3000`. Fuera de
`next dev` (en la imagen, `NODE_ENV=production`) se ignora, y hay un test que lo
comprueba.

## Pendiente

- [ ] Revisión de seguridad del repo antes de la primera emisión real (KAN-15).
- [ ] Que la página pública respete la ocultación y no enseñe los campos
      privados de la plantilla (KAN-12). En la credencial ya no entran (KAN-11).
- [ ] Límite de peticiones en la búsqueda pública, cuando exista (KAN-12).
- [ ] Texto de privacidad revisado: borrador en `docs/privacidad.md`.
