# Cómo contribuir

¡Gracias por echar una mano! PopiCert emite credenciales firmadas en nombre de una
organización, así que cuidamos sobre todo la corrección y la seguridad.

## Antes de abrir un PR

1. Abre un issue si el cambio no es pequeño, para hablarlo antes.
2. Trabaja en una rama a partir de `main`.
3. Asegúrate de que pasa todo:

   ```sh
   docker compose up -d db
   npm run lint && npm run typecheck && npm run db:migrate && npm test
   ```

## Reglas del proyecto

- **Tests contra una base de datos vacía.** Nada de depender de datos previos.
- **Tests de autorización desde el principio.** Cualquier ruta que escriba
  (emitir, revocar, editar, ocultar) lleva tests de que sin un token válido de
  Cloudflare Access responde 403.
- **Sin red al firmar ni al verificar.** Los contextos JSON-LD van empaquetados.
  Si hace falta uno nuevo, se añade a `src/lib/ob/contexts/` como copia literal
  del publicado y se comprueba con `npm run check-contexts`.
- **Nada de secretos** en el código, en los tests, en los logs ni en la base de
  datos. Las semillas de los tests son fijas y públicas a propósito.
- **Datos personales:** el email solo con hash y sal; datos sensibles como el
  DNI, nunca en la credencial ni en la página pública.
- **Commits** con [Conventional Commits](https://www.conventionalcommits.org/es/)
  (`feat:`, `fix:`, `docs:`…), con un cuerpo que explique el porqué.

## Seguridad

Si encuentras una vulnerabilidad, **no abras un issue público**: escribe a
info@popiai.es.
