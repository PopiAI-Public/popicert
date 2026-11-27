/**
 * Error de una plantilla que se puede enseñar tal cual en el admin: el mensaje
 * explica qué está mal en el fichero subido o en los datos y cómo arreglarlo.
 */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}
