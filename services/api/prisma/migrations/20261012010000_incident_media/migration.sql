-- Photos and videos attached to incident reports.
-- Idempotent: safe to re-run on a database that already has the table.

CREATE TABLE IF NOT EXISTS incident_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   UUID          NOT NULL,
  type          "EvidenceType" NOT NULL,
  file_key      VARCHAR(1000) NOT NULL,
  original_name VARCHAR(255)  NOT NULL,
  mime_type     VARCHAR(100)  NOT NULL,
  size_bytes    BIGINT        NOT NULL,
  checksum      VARCHAR(64)   NOT NULL,
  source        VARCHAR(20)   NOT NULL DEFAULT 'reporter',
  uploaded_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_media_incident_id_fkey') THEN
    ALTER TABLE incident_media
      ADD CONSTRAINT incident_media_incident_id_fkey
      FOREIGN KEY (incident_id) REFERENCES incident_reports(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS incident_media_incident_id_idx ON incident_media(incident_id);
