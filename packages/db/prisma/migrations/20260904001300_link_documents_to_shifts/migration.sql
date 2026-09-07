-- The shift a sale was rung on, kept on the document rather than worked out
-- from time ranges. A time range is wrong in the two cases that matter most:
-- two registers open at once, and an offline device uploading its sales hours
-- later — those arrive stamped with the moment they synced, which is a
-- different shift or none at all.
--
-- Nullable, and left null on every existing row: those sales were reconciled
-- by time and there is nothing to backfill them from without guessing.
ALTER TABLE "documents" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "documents_shiftId_idx" ON "documents"("shiftId");

ALTER TABLE "documents" ADD CONSTRAINT "documents_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
