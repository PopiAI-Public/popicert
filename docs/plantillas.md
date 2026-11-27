# Plantillas de diploma

Los diplomas no tienen un diseño fijo. Se diseñan fuera (por ejemplo, pidiéndoselo
a Claude), se suben al admin de PopiCert y PopiCert rellena los datos de cada
asistente y genera un PDF vectorial con el QR de verificación.

Hay una plantilla de ejemplo completa en [`plantillas/ejemplo`](../plantillas/ejemplo):
el SVG y sus fuentes. Es el mejor punto de partida para un diseño nuevo.

## Reglas del SVG

### Medidas

- **A4**, en horizontal o en vertical. Trabaja en milímetros:
  `viewBox="0 0 297 210"` (horizontal) o `viewBox="0 0 210 297"` (vertical).
  PopiCert rechaza cualquier otra proporción.
- Todas las medidas (`x`, `y`, `font-size`…) en esas unidades y **sin unidades
  escritas**: `font-size="5"`, no `font-size="5mm"` ni `"14pt"`.
- Deja al menos 8–10 mm de margen en los bordes: muchas impresoras no llegan.

### Campos

- Cada dato variable es un **marcador** dentro de un `<text>`:
  `{{nombre}}`, `{{formacion}}`, `{{horas}}`, `{{fecha}}`, `{{lugar}}`,
  `{{ponente}}`… o cualquier otro que se te ocurra (`{{numero_colegiado}}`).
- Los nombres de los marcadores van en minúsculas, sin tildes ni espacios: letras,
  números y `_`. `{{Formación}}` no vale; `{{formacion}}`, sí.
- El texto tiene que ser **texto de verdad**, no convertido a trazados (en
  Illustrator, Figma o Inkscape: no «contornear» ni «convertir a curvas» los textos
  con marcadores).
- Un marcador entero en el mismo `<text>` o `<tspan>`, **sin cambios de estilo
  en medio**. Puede ir rodeado de texto fijo:
  `<text …>con una duración de {{horas}} horas</text>`.
- Al subirla, PopiCert detecta los campos y, para cada uno, se elige en el admin:
  - **de quién es**: de la formación (igual para todos: fecha, lugar, ponente) o
    del asistente (va en el CSV: nombre, DNI…);
  - si es **obligatorio**;
  - si es **público**: sale en la página del certificado y en la credencial
    verificable, o solo en el PDF (por ejemplo, el DNI).

### Campos reservados

Los rellena PopiCert; no se configuran:

| Marcador | Qué pone |
| --- | --- |
| `{{codigo}}` | El código del certificado, por ejemplo `ABCD234567`. |
| `{{url}}` | La URL pública del certificado. |

### El QR (obligatorio)

Un rectángulo con `id="qr"` marca dónde va el QR y de qué tamaño:

```xml
<rect id="qr" x="24" y="150" width="34" height="34" fill="#e0e0e0"/>
```

- Tiene que ser un `<rect>` con `x`, `y`, `width` y `height` numéricos.
- PopiCert lo sustituye por el QR (negro sobre blanco, con su margen blanco
  dentro de la caja). El relleno del rectángulo da igual: solo sirve para verlo
  mientras diseñas.
- **Mínimo 25 × 25 mm** para que se lea bien impreso; 30–35 mm es lo cómodo.
- Fondo claro alrededor y nada encima.

### Textos que pueden no caber

En los textos con datos de longitud variable (el nombre, el título de la
formación), indica el ancho máximo con `data-max-width`, en las mismas unidades
del `viewBox`:

```xml
<text x="148.5" y="92" font-size="14" text-anchor="middle" data-max-width="230">{{nombre}}</text>
```

Si el texto no cabe, PopiCert reduce el tamaño de letra hasta que quepa. Con
`text-anchor="middle"` y `x` en el centro de la página, el texto queda centrado
a cualquier tamaño.

### Fuentes

- Se usan las fuentes que se **suban junto a la plantilla**: TTF, OTF o WOFF.
  **WOFF2 no** (no se puede incrustar en el PDF). Un fichero por estilo
  (normal, cursiva, negrita, negrita cursiva).
- En el SVG, `font-family` tiene que coincidir con el nombre de familia de la
  fuente (el que sale en el admin después de subirla, por ejemplo `EB Garamond`).
  Pon el estilo con `font-weight="bold"` y `font-style="italic"`.
- Sin fuentes subidas, `serif` es Times, `sans-serif` es Helvetica y `monospace`
  es Courier. Solo tienen los caracteres de Europa occidental (todo el español
  sí; la `Ł` polaca o el griego, no).
- Si a una fuente le falta un carácter de los datos (por ejemplo, un nombre con
  `Ł` y una fuente solo latina), el PDF no se genera y el error dice qué carácter
  falta: mejor eso que un diploma con cuadraditos.
- Busca fuentes con licencia que permita incrustarlas (SIL OFL, como las de
  Google Fonts). Nada se descarga de internet al generar el PDF.
- Pon la familia, el tamaño y el estilo **como atributos** del `<text>`
  (`font-family="…"`, `font-size="…"`). Las clases CSS funcionan para colores,
  pero el ajuste de tamaño y la comprobación de caracteres solo leen atributos y
  `style="…"`.

### Qué se puede usar

- Formas (`rect`, `circle`, `path`, `line`, `polygon`…), grupos, `defs`/`use`,
  degradados, patrones, máscaras y recortes.
- Imágenes **incrustadas** en PNG o JPEG (`href="data:image/png;base64,…"`), por
  ejemplo un logo o una firma escaneada.

### Qué no (se quita al subir, y el admin avisa)

- `<script>`, atributos `on…`, `<foreignObject>`, animaciones y enlaces `<a>`.
- Cualquier cosa que cargue algo de fuera: imágenes por URL o ruta de fichero,
  `@import` o `@font-face` en el CSS, `url(…)` que no sea a un elemento del propio
  SVG (`url(#degradado)`).
- Filtros (sombras, desenfoques): el generador de PDF no los dibuja. Simúlalos con
  formas o transparencias.
- `DOCTYPE` y entidades: si el SVG los trae, se rechaza entero. Exporta como
  «SVG simple».

## Diseñar con Claude

Un prompt que funciona bien (cambia el estilo a tu gusto):

> Diséñame un diploma en SVG para PopiCert. Requisitos técnicos, todos obligatorios:
>
> - `viewBox="0 0 297 210"` (A4 horizontal, en milímetros), `width="297mm"` y
>   `height="210mm"`. Todas las medidas sin unidades.
> - Textos como `<text>` con atributos `font-family`, `font-size`, `font-weight`
>   y `font-style`; nada de clases CSS para la tipografía. Fuente: `EB Garamond`
>   (normal, cursiva, negrita y negrita cursiva).
> - Marcadores de campo literales dentro de los textos: `{{nombre}}`,
>   `{{formacion}}`, `{{horas}}`, `{{lugar}}`, `{{fecha}}`, `{{ponente}}`,
>   `{{codigo}}` y `{{url}}`. Cada marcador entero dentro de un mismo `<text>`.
> - En el nombre y en el título de la formación, `text-anchor="middle"` y
>   `data-max-width` con el ancho disponible en mm.
> - Un `<rect id="qr">` de 34×34 mm en una esquina inferior, sobre fondo claro,
>   para el QR de verificación; junto a él, «Código {{codigo}}» y «Verifica este
>   certificado en {{url}}» en letra pequeña.
> - Márgenes de al menos 9 mm. Sin filtros, sin imágenes externas, sin scripts,
>   sin `@import` ni `@font-face`, sin DOCTYPE.
>
> Estilo: sobrio y elegante, colores azul petróleo `#1f3b4d` y dorado `#b08d3c`,
> fondo crema, un marco doble fino. Arriba «POPIAI» espaciado y el título
> «Certificado de aprovechamiento».

Después:

1. Guarda el SVG y ábrelo en el navegador para ver que se parece a lo que
   querías (con la fuente instalada en el ordenador se verá igual que el PDF).
2. Súbelo en el admin, **Plantillas → Subir una plantilla nueva**, con las
   fuentes.
3. Lee los avisos: lo que se ha quitado por seguridad, fuentes que faltan,
   marcadores mal escritos.
4. Revisa la vista previa, que usa a propósito datos largos y con tildes, y abre
   el PDF de prueba.
5. **Imprime el PDF y escanea el QR con el móvil.**
6. Ajusta la configuración de los campos (de quién es cada uno, obligatorio,
   público) y guarda.

## Versiones

- Cambiar el diseño es subir una **versión nueva** desde la página de la
  plantilla. La configuración de los campos que sigan existiendo se copia de la
  versión anterior.
- Cada certificado recuerda con qué versión se generó. En cuanto se emite el
  primer certificado con una versión, esa versión queda **bloqueada**: ni su
  diseño, ni sus fuentes, ni sus campos cambian, y no se puede borrar. Lo
  garantiza la propia base de datos, así que el PDF de un certificado emitido
  sale siempre igual.
- El diseño (SVG y fuentes) de una versión no cambia nunca, ni siquiera antes de
  usarla; lo único que se puede tocar mientras no se ha usado es la
  configuración de los campos.
