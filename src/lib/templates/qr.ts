/**
 * El QR del diploma, dibujado como un trazado vectorial: se imprime nítido a
 * cualquier tamaño y no depende de imágenes.
 */
import QRCode from "qrcode";

/** Margen blanco alrededor del QR, en módulos, dentro de la caja de la plantilla. */
export const QR_MARGIN_MODULES = 2;

export interface QrPath {
  /** Módulos por lado, sin el margen. */
  size: number;
  /** Trazado en unidades de módulo: cada módulo oscuro es un cuadrado de 1×1. */
  d: string;
}

export function qrPath(text: string): QrPath {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size } = qr.modules;
  const parts: string[] = [];
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && qr.modules.get(row, col)) col++;
      // Una fila de módulos seguidos en un solo rectángulo: menos trazos y sin rendijas entre ellos.
      parts.push(`M${start} ${row}h${col - start}v1h${start - col}z`);
    }
  }
  return { size, d: parts.join("") };
}
