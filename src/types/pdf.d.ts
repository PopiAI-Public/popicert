// Tipos mínimos para svg-to-pdfkit y fontkit, que no publican los suyos.
// Solo cubren lo que usa PopiCert.

declare module "svg-to-pdfkit" {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    precision?: number;
    fontCallback?: (family: string, bold: boolean, italic: boolean, fontOptions: { fauxBold?: boolean; fauxItalic?: boolean }) => string;
    imageCallback?: (link: string) => string | Buffer;
    documentCallback?: (file: string) => unknown;
    warningCallback?: (message: string) => void;
  }
  export default function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x: number, y: number, options?: SVGtoPDFOptions): void;
}

declare module "fontkit" {
  export interface Font {
    familyName: string;
    subfamilyName: string;
    postscriptName: string;
    italicAngle: number;
    "OS/2"?: { usWeightClass?: number; fsSelection?: { italic?: boolean } };
    getName(key: string): string | null;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export interface FontCollection {
    fonts: Font[];
  }
  export function create(buffer: Buffer | Uint8Array): Font | FontCollection;
}
