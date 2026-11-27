-- CreateTable
CREATE TABLE "badge_image" (
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_image_pkey" PRIMARY KEY ("sha256")
);

-- CreateTable
CREATE TABLE "achievement" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "hours" INTEGER,
    "badge_sha256" TEXT,
    "template_version_id" UUID NOT NULL,
    "training_values" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "achievement_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "status_entry_id" UUID NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "attendee_values" JSONB NOT NULL,
    "training_values" JSONB NOT NULL,
    "credential" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "issued_by" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" TEXT,
    "hidden_at" TIMESTAMPTZ(3),
    "hidden_reason" TEXT,

    CONSTRAINT "credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "achievement_created_at_idx" ON "achievement"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credential_code_key" ON "credential"("code");

-- CreateIndex
CREATE UNIQUE INDEX "credential_status_entry_id_key" ON "credential"("status_entry_id");

-- CreateIndex
CREATE INDEX "credential_achievement_id_issued_at_idx" ON "credential"("achievement_id", "issued_at");

-- CreateIndex
CREATE INDEX "credential_recipient_name_idx" ON "credential"("recipient_name");

-- AddForeignKey
ALTER TABLE "achievement" ADD CONSTRAINT "achievement_badge_sha256_fkey" FOREIGN KEY ("badge_sha256") REFERENCES "badge_image"("sha256") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement" ADD CONSTRAINT "achievement_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential" ADD CONSTRAINT "credential_status_entry_id_fkey" FOREIGN KEY ("status_entry_id") REFERENCES "status_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Idempotencia de la emisión: un asistente (email, DNI o nombre normalizados)
-- tiene como mucho un certificado vigente por formación. Repetir un CSV no
-- emite dos veces, aunque dos emisiones lleguen a la vez. Los revocados no
-- cuentan, para poder rectificar: se revoca el erróneo y se emite otro.
CREATE UNIQUE INDEX "credential_achievement_dedupe_active_key"
  ON "credential"("achievement_id", "dedupe_key")
  WHERE "revoked_at" IS NULL;

-- Un certificado emitido no cambia: ni la credencial firmada ni los datos con
-- los que se genera su PDF. Solo se puede revocar (una vez, sin vuelta atrás)
-- y ocultar o volver a mostrar a petición del asistente.
CREATE FUNCTION credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.achievement_id IS DISTINCT FROM OLD.achievement_id
     OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.status_entry_id IS DISTINCT FROM OLD.status_entry_id
     OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
     OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.attendee_values IS DISTINCT FROM OLD.attendee_values
     OR NEW.training_values IS DISTINCT FROM OLD.training_values
     OR NEW.credential IS DISTINCT FROM OLD.credential
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'popicert: un certificado emitido no se modifica; revócalo y emite otro';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
    RAISE EXCEPTION 'popicert: una revocación no se deshace';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER credential_guard
  BEFORE UPDATE ON "credential"
  FOR EACH ROW EXECUTE FUNCTION credential_guard();
