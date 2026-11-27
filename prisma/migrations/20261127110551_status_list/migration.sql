-- CreateTable
CREATE TABLE "status_list" (
    "id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'revocation',
    "size" INTEGER NOT NULL,
    "credential" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "status_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_entry" (
    "id" UUID NOT NULL,
    "list_id" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" TEXT,

    CONSTRAINT "status_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_entry_list_id_revoked_at_idx" ON "status_entry"("list_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "status_entry_list_id_index_key" ON "status_entry"("list_id", "index");

-- AddForeignKey
ALTER TABLE "status_entry" ADD CONSTRAINT "status_entry_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "status_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
