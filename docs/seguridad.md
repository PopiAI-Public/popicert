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

### 3 bis. CSRF: las escrituras tienen que venir del propio admin

La cookie de Cloudflare Access viaja en cualquier petición al host del admin,
también en las que lanza otra web abierta en el mismo navegador (un `fetch`
con `mode: "no-cors"` y cuerpo `text/plain` no necesita preflight). Por eso
`adminHandler`, en todo lo que no sea `GET` o `HEAD`, exige además:

- `Sec-Fetch-Site: same-origin` si el navegador lo manda;
- `Origin` igual al host del admin (y sin ninguna de las dos, 403);
- y los cuerpos JSON con `Content-Type: application/json`, que no se puede
  mandar sin preflight.

Hay un test por cada forma de intentarlo (otra web, otro subdominio de
`luismi.dev`, `Origin: null`, sin `Origin`, `text/plain`).

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
- Límite de **complejidad**: al expandir los `<use>` y las referencias
  `url(#…)`, como mucho 5.000 elementos, y sin referencias circulares. Sin
  él, un SVG de 1 KB con `<use>` anidados («bomba de `<use>`») tardaba
  minutos en pasar a PDF con el servidor entero bloqueado.
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

### 8 bis. La revocación, también en la base de datos

- La revocación que se publica sale de `status_entry`. Un trigger impide
  cambiar la lista o la posición de una entrada, deshacer una revocación y
  borrar una entrada revocada; otro, borrar una lista publicada o bajar su
  versión.
- Al volver a firmar una lista, los bits revocados son la **unión** de
  `status_entry` y `credential.revoked_at`: aunque alguien tocara una de las
  dos copias, el certificado sigue publicado como revocado.
- Los triggers no protegen de quien es **dueño** de las tablas (puede
  desactivarlos). En producción conviene separar los usuarios: las migraciones
  con `MIGRATION_DATABASE_URL` (dueño) y la app con `DATABASE_URL`, un usuario
  que solo lee y escribe filas:

  ```sql
  CREATE ROLE popicert_app LOGIN PASSWORD '…';
  GRANT CONNECT ON DATABASE popicert TO popicert_app;
  GRANT USAGE ON SCHEMA public TO popicert_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO popicert_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE popicert IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO popicert_app;
  ```

### 9. Parte pública del certificado

- Todo lo que enseña `/c/<código>` sale de la credencial firmada, así que los
  campos privados de la plantilla no pueden aparecer en la página ni en el JSON.
- El **PDF público** deja en blanco los campos privados (DNI…): el enlace del
  certificado se comparte, y el DNI no debe ir con él. El PDF completo solo se
  descarga desde el admin, para entregarlo al asistente.
- Un certificado oculto responde con un aviso genérico (y 410 en el JSON, 404
  en el PDF), sin nombre ni formación, también en los metadatos y en la imagen
  de vista previa.
- Las URL de la página, el QR y los metadatos salen de `PUBLIC_URL` y de la
  credencial, nunca de la cabecera `Host`.
- Límites por IP: 30 peticiones por minuto en `/verificar` y `/api/verificar`,
  120 en `/c/`.
- `/api/verificar` es el único `POST` fuera del admin: lleva el JSON en el
  cuerpo pero no escribe nada. `tests/routes-structure.test.ts` lo tiene en una
  lista explícita y comprueba que no toca la base de datos más que para leer.
  Acepta como mucho 64 KB.
- Las páginas de certificado, el PDF, el JSON y la imagen de vista previa
  llevan `noindex`: se comparten, pero no tienen por qué salir en los
  buscadores. El PDF y el JSON van con `Cache-Control: private, no-cache`, para
  que al ocultar un certificado no quede copia en la caché de Cloudflare.
- El PDF público se genera como mucho de dos en dos y se guarda en memoria
  (sale siempre igual); la verificación, de cuatro en cuatro. Aunque alguien
  se salte el límite por IP, no deja sin CPU al resto de la app.
- `/_next/image` está desactivado (`images.unoptimized`): no se usa y sería un
  endpoint público que gasta CPU.
- Un campo de documento de identidad (`dni`, `nie`, `pasaporte`…) no se puede
  marcar como público: iría firmado en la credencial sin vuelta atrás.
- `/insignias/<sha256>` comprueba que lo que sirve tiene ese sha256.

## Desarrollo en local

Con `next dev`, `DEV_ADMIN_EMAIL` permite entrar en el admin sin Cloudflare
Access, poniendo `ADMIN_HOST` a, por ejemplo, `admin.localhost:3000`. Fuera de
`next dev` (en la imagen, `NODE_ENV=production`) se ignora, y hay un test que lo
comprueba.

## Pendiente

- [x] Revisión de seguridad del repo antes de la primera emisión real (KAN-15):
      hecha el 28 nov 2026; sus hallazgos están corregidos arriba (CSRF, bomba de
      `<use>`, triggers de la revocación, cachés), salvo la supresión de datos.
- [ ] Decidir cómo se suprimen los datos personales (ver `docs/privacidad.md`):
      el trigger de `credential` hoy no deja borrar el email ni el DNI de un
      certificado, y el registro de auditoría guarda el nombre.
- [ ] Separar en producción el usuario de las migraciones del de la app (arriba).
- [ ] Texto de privacidad revisado: borrador en `docs/privacidad.md`.
