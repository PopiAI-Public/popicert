# Privacidad (BORRADOR, pendiente de revisión)

> **No publicar tal cual.** Es un borrador técnico para que PopiAI lo revise
> (KAN-15: «texto de privacidad revisado»). Lo que está entre [corchetes] hay que
> decidirlo.

## Aviso corto para los asistentes

Para el email de emisión (KAN-14) y la página del certificado:

> Tu certificado tiene una página pública en certificados.popiai.es con tu
> nombre y la formación que has hecho, para que puedas compartirlo y cualquiera
> pueda comprobar que es auténtico. Si prefieres que no sea público, escríbenos a
> info@popiai.es y lo ocultamos.

## Qué datos trata PopiCert

| Dato | Dónde aparece | Por qué |
| --- | --- | --- |
| Nombre y apellidos | Página pública, credencial firmada y PDF | Identifica al titular del certificado |
| Formación, fechas, horas, lugar, ponente | Página pública, credencial y PDF | Es el contenido del certificado |
| Email (si se recoge) | Solo en la base de datos. En la credencial va con hash y sal, nunca en claro | Enviar el certificado y que el titular pueda demostrar que es suyo |
| DNI u otros datos sensibles (si la plantilla los pide) | **Solo en el PDF**. Nunca en la página ni en la credencial | Requisito de algunas formaciones bonificadas |
| Email del administrador | Registro de auditoría | Saber quién emitió o revocó cada certificado |

PopiCert no usa cookies propias ni analítica en la parte pública. Cloudflare,
que sirve la web, trata las IP de las visitas para entregar la web y protegerla.

## Base legal

[Ejecución del contrato de formación o interés legítimo en acreditar la
asistencia. Para la página pública, a decidir: interés legítimo con derecho de
oposición (ocultar a petición) o consentimiento explícito al inscribirse.]

## Conservación

- **Certificados:** [mientras PopiAI exista como emisor, porque el certificado
  debe poder verificarse siempre]. A petición del titular, el certificado se
  oculta: la página deja de mostrar sus datos, aunque la credencial que ya tenga
  descargada sigue siendo válida.
- **Datos que solo van en el PDF (DNI…):** [N años, según la obligación de
  justificación de la formación bonificada, si aplica].
- **Registro de auditoría:** [N años].
- **Copias de seguridad:** [30 días de retención en Google Drive, por Duplicati].

## Derechos

Acceso, rectificación, supresión, oposición y limitación en info@popiai.es.

- **Rectificación:** se revoca el certificado erróneo y se emite uno nuevo.
- **Supresión:** se oculta el certificado y se borran los datos personales de la
  base de datos. Las credenciales que el titular ya tenga descargadas no se
  pueden borrar, porque están en su poder, pero se pueden revocar.

## Responsable

PopiAI, info@popiai.es. [Datos completos del responsable: razón social, NIF,
dirección.]
