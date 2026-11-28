# PopiCert

Plataforma open source de certificados con **Open Badges 3.0**, hecha por
[PopiAI](https://popiai.es) para las credenciales de sus formaciones.

Cada certificado es una credencial verificable W3C 2.0 (`OpenBadgeCredential`)
firmada por el emisor `did:web` del dominio público. Cualquiera puede comprobarla
en la propia web o con un verificador externo de Open Badges 3.0.

> **Estado:** en desarrollo. Ya están la base del proyecto, el núcleo de firma y
> verificación, la revocación, las plantillas de diploma y el panel de
> administración con la emisión y la página pública del certificado. Falta el
> despliegue en el servidor y el piloto con una formación real.

## Qué hace (y qué hará)

- **Núcleo Open Badges 3.0** ✅
  - Credenciales `OpenBadgeCredential` con `AchievementSubject` y `Achievement`.
  - Firma Data Integrity `eddsa-rdfc-2022` (Ed25519) con las librerías de Digital Bazaar.
  - Emisor `did:web` con su documento DID en `/.well-known/did.json`.
  - Contextos JSON-LD empaquetados: no se descarga nada al firmar ni al verificar.
  - Nombre del asistente en claro y email solo con hash y sal.
  - Rotación de claves sin invalidar lo ya emitido ([docs/rotacion-de-claves.md](docs/rotacion-de-claves.md)).
- **Revocación con W3C Bitstring Status List** ✅
  - Cada credencial lleva un `BitstringStatusListEntry` con un índice aleatorio.
  - Lista firmada y pública en `/status/<n>`, de 131.072 entradas y con caché de 5 minutos.
  - Revocar guarda el motivo y la fecha y vuelve a firmar la lista. La credencial emitida no se toca.
- **Plantillas de diploma** ✅ ([docs/plantillas.md](docs/plantillas.md))
  - Diseño en SVG (A4) con marcadores `{{campo}}`, hecho fuera, por ejemplo con Claude.
  - Al subirlo se sanea, se detectan los campos y se configura cada uno (de la formación o del asistente, obligatorio, público).
  - PDF vectorial en el servidor, sin navegador, con las fuentes incrustadas y el QR de verificación.
  - Versionado: una versión usada en certificados no cambia nunca (triggers en PostgreSQL).
- **Panel de administración** tras Cloudflare Access ✅
  - Formaciones (el `Achievement`): nombre, descripción, criterios, horas, insignia y plantilla de diploma.
    Con certificados no se borran, se archivan.
  - Emisión individual y desde CSV (`,` o `;`, UTF-8 o Windows-1252), con vista previa fila a fila.
  - Idempotente: un asistente (DNI o nombre normalizado) tiene como mucho un certificado vigente
    por formación, aunque se repita el CSV o lleguen dos emisiones a la vez (índice único parcial).
  - Sin emails todavía (KAN-14): enlaces para copiar y exportación a CSV con nombre, enlace y código.
  - Búsqueda por nombre o código, revocación con motivo, ocultación a petición del asistente (RGPD)
    y PDF del certificado con la credencial firmada adjunta.
  - Registro de auditoría de cada acción, con el email de Access.
- **Página pública del certificado** en `/c/<código>` ✅
  - Estado (válido o revocado, con fecha y motivo), formación, insignia y los campos públicos de la
    plantilla, sacados de la credencial firmada: la página y el JSON dicen siempre lo mismo.
  - QR, PDF (sin los campos privados), JSON firmado y «Añadir a LinkedIn».
  - Negociación de contenido: con `Accept: application/ld+json` la misma URL da la credencial.
  - Open Graph con imagen generada en el servidor, para la vista previa en LinkedIn o WhatsApp.
  - `/verificar`: por código o subiendo el JSON, con cada comprobación por separado.
  - Un certificado oculto a petición del titular solo dice que lo está.

Sin cuentas de usuario ni registro: solo se puede emitir desde el panel protegido.
El admin vive en otro host, tras Cloudflare Access, y la app valida el token de
Access en cada petición. Detalles en [docs/seguridad.md](docs/seguridad.md).

## Stack

Next.js 16 (App Router) con TypeScript, PostgreSQL con Prisma 7 y Vitest.
Requiere Node.js 22.12 o posterior.

## En local

```sh
npm install
cp .env.example .env          # y rellena POPICERT_SIGNING_KEY (ver abajo)
docker compose up -d db       # PostgreSQL vacía en localhost:55432
npm run db:migrate
npm run dev                   # http://localhost:3000
```

La clave de firma de desarrollo se genera con:

```sh
npm run keygen -- http://localhost:3000
```

Pon la semilla que imprime en `POPICERT_SIGNING_KEY`, y `PUBLIC_URL=http://localhost:3000`
para que el DID coincida.

### Todo en Docker

```sh
docker compose up --build     # http://localhost:3100
```

Arranca la app contra una PostgreSQL vacía, sin pasos manuales: las migraciones
se aplican al arrancar. La base de datos está en memoria y empieza vacía cada vez
que se recrea el contenedor. La clave de firma, si quieres probar el DID, va en
un fichero `.env.docker` (no se sube al repo).

### Comprobaciones

```sh
npm run lint
npm run typecheck
npm test                      # con DATABASE_URL, también los de integración
                              # con Poppler (pdftotext, pdftoppm), también los que leen el PDF y su QR
npm run check-contexts        # compara los contextos empaquetados con los publicados
npm run sample-credential     # imprime una credencial de ejemplo firmada
```

## Despliegue

PopiCert se publica como imagen de Docker en GHCR:
`ghcr.io/popiai-public/popicert:vX.Y.Z`. La imagen se publica al crear un tag
`vX.Y.Z`. No hay tag `latest`: se despliega siempre una versión concreta.

El contenedor:

- escucha en el puerto **3000**;
- aplica las migraciones pendientes al arrancar;
- expone `GET /api/health`: 200 con la base de datos accesible y 503 sin ella;
- se configura solo con variables de entorno (ver [`.env.example`](.env.example)).

| Variable | Para qué |
| --- | --- |
| `PUBLIC_URL` | URL pública definitiva. Va en cada credencial y define el DID. |
| `ADMIN_HOST` | Host del panel de administración. |
| `DATABASE_URL` | Conexión a PostgreSQL. |
| `POPICERT_SIGNING_KEY` | **Secreto.** Semilla de la clave de firma activa. |
| `POPICERT_RETIRED_PUBLIC_KEYS` | Claves públicas retiradas, separadas por comas. |
| `ISSUER_NAME`, `ISSUER_URL`, `ISSUER_EMAIL` | Perfil del emisor. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Validación del token de Cloudflare Access. Sin ellas, nadie entra en el admin. |
| `ADMIN_EMAILS` | Emails que pueden usar el admin, separados por comas. |

> **`PUBLIC_URL` no se puede cambiar** una vez emitidos certificados: va grabada
> en cada credencial y en cada QR.

## Licencia

[MIT](LICENSE). Contribuciones bienvenidas: ver [CONTRIBUTING.md](CONTRIBUTING.md).

El contexto JSON-LD de Open Badges 3.0 (`src/lib/ob/contexts/`) y el JSON Schema
de los tests (`tests/fixtures/1edtech/`) son copias literales de los que publica
[1EdTech](https://www.1edtech.org/standards/open-badges).
