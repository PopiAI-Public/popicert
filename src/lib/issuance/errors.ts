/**
 * Error de la emisión que se puede enseñar tal cual en el admin: dice qué está
 * mal en los datos y cómo arreglarlo. Las rutas lo convierten en un 422.
 */
export class IssuanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssuanceError";
  }
}

/** La formación o el certificado no existen. Las rutas lo convierten en un 404. */
export class NotFoundError extends Error {
  constructor(what: "formación" | "certificado") {
    super(`${what.charAt(0).toUpperCase()}${what.slice(1)} no encontrad${what === "formación" ? "a" : "o"}.`);
    this.name = "NotFoundError";
  }
}
