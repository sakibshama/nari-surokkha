-- On-device ML: model registry + real-data training samples.

-- CreateTable
CREATE TABLE "ml_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(50) NOT NULL,
    "version" INTEGER NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "file_key" VARCHAR(500) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ml_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_training_samples" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "kind" VARCHAR(50) NOT NULL,
    "label" VARCHAR(50),
    "source" VARCHAR(50) NOT NULL,
    "window" JSONB NOT NULL,
    "sample_rate" INTEGER NOT NULL,
    "device_info" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_training_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ml_models_kind_version_format_key" ON "ml_models"("kind", "version", "format");
CREATE INDEX "ml_models_kind_is_active_idx" ON "ml_models"("kind", "is_active");
CREATE INDEX "ml_training_samples_kind_label_idx" ON "ml_training_samples"("kind", "label");
CREATE INDEX "ml_training_samples_created_at_idx" ON "ml_training_samples"("created_at");
