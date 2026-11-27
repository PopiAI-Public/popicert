-- CreateTable
CREATE TABLE "template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_version" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "svg" TEXT NOT NULL,
    "svg_sha256" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "locked_at" TIMESTAMPTZ(3),

    CONSTRAINT "template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_font" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "bold" BOOLEAN NOT NULL,
    "italic" BOOLEAN NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,

    CONSTRAINT "template_font_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_version_template_id_version_key" ON "template_version"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "template_font_version_id_family_bold_italic_key" ON "template_font"("version_id", "family", "bold", "italic");

-- AddForeignKey
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_font" ADD CONSTRAINT "template_font_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "template_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Inmutabilidad de las versiones de plantilla.
--
-- El contenido de una versión (SVG, orientación, fuentes) no cambia nunca: para
-- cambiar el diseño se crea una versión nueva. La configuración de los campos
-- se puede ajustar mientras la versión no se haya usado; en cuanto se emite el
-- primer certificado con ella (locked_at), ya no cambia nada ni se puede borrar.
-- Así el PDF de un certificado emitido sale siempre igual, aunque alguien
-- intente cambiar la plantilla desde la aplicación o directamente en la base de datos.

CREATE FUNCTION template_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'popicert: la versión % de la plantilla ya se ha usado en certificados y no se puede borrar', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.svg IS DISTINCT FROM OLD.svg
     OR NEW.svg_sha256 IS DISTINCT FROM OLD.svg_sha256
     OR NEW.orientation IS DISTINCT FROM OLD.orientation
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'popicert: el contenido de una versión de plantilla no se modifica; crea una versión nueva';
  END IF;

  IF OLD.locked_at IS NOT NULL
     AND (NEW.locked_at IS DISTINCT FROM OLD.locked_at
          OR NEW.fields IS DISTINCT FROM OLD.fields
          OR NEW.report IS DISTINCT FROM OLD.report) THEN
    RAISE EXCEPTION 'popicert: la versión % de la plantilla ya se ha usado en certificados; crea una versión nueva', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER template_version_guard
  BEFORE UPDATE OR DELETE ON "template_version"
  FOR EACH ROW EXECUTE FUNCTION template_version_guard();

CREATE FUNCTION template_font_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'popicert: las fuentes de una versión de plantilla no se modifican; crea una versión nueva';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "template_version"
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.version_id ELSE OLD.version_id END
      AND locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'popicert: la versión de la plantilla ya se ha usado en certificados; sus fuentes no cambian';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER template_font_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "template_font"
  FOR EACH ROW EXECUTE FUNCTION template_font_guard();
