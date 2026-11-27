# Rotación de la clave de firma

PopiCert firma cada certificado con una clave Ed25519. La parte pública se
publica en el documento DID (`/.well-known/did.json`), que es lo que consultan
los verificadores. La parte privada es una semilla de 32 bytes que solo vive en
el secreto del despliegue (`POPICERT_SIGNING_KEY`) y en el gestor de contraseñas.

**Regla de oro:** una clave pública que ha firmado algo **no se quita nunca** del
documento DID. Si se quita, todos los certificados firmados con ella dejan de
verificarse.

## Cuándo rotar

- Si la clave privada se ha filtrado o se sospecha que se ha filtrado.
- Por higiene, si se decide una caducidad (por ejemplo, cada pocos años).

## Cómo rotar

1. Genera la clave nueva:

   ```sh
   npm run keygen -- https://certificados.popiai.es
   ```

   Anota la **clave pública** de la clave **actual** antes de sustituirla. Si no
   la tienes a mano, está en `https://certificados.popiai.es/.well-known/did.json`:
   es la primera de `verificationMethod`.

2. Guarda la semilla nueva en el gestor de contraseñas, junto a la anterior. No
   borres la anterior.

3. En el despliegue (Dokploy):
   - `POPICERT_SIGNING_KEY` = la semilla **nueva**.
   - `POPICERT_RETIRED_PUBLIC_KEYS` = la clave pública **anterior**, añadida a
     las que ya hubiera, separadas por comas.

4. Despliega y comprueba:
   - `/.well-known/did.json` lista la clave nueva la primera y todas las retiradas.
   - Un certificado emitido antes de la rotación sigue verificando en `/verificar`
     y en un verificador externo.
   - Un certificado nuevo verifica.

## Si la clave se ha filtrado

Retirar la clave no basta: quien la tenga puede seguir firmando credenciales que
verifican, porque la clave pública sigue en el documento DID. En ese caso:

1. Rota como arriba.
2. Revoca (KAN-10) los certificados emitidos con la clave filtrada y vuelve a
   emitirlos con la nueva.
3. Solo entonces, valora quitar la clave filtrada del documento DID, sabiendo que
   todo lo firmado con ella dejará de verificar.

## Por qué así

- La semilla no está en la base de datos: con acceso de escritura a la base de
  datos no se puede firmar.
- Las claves públicas tampoco están en la base de datos: si estuvieran, con
  acceso de escritura a la base de datos alguien podría añadir su propia clave
  al documento DID y firmar en nombre de PopiAI.
- El id de cada clave es su propia clave pública (`did:web:…#z6Mk…`), así que
  no hay nombres que mantener.
