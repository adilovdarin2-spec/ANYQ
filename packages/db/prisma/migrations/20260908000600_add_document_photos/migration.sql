-- A photograph of the paper a document came from.
--
-- A delivery note is the only record of what the driver actually brought, and
-- it leaves with him. Every argument about a short delivery is an argument about
-- a piece of paper nobody has any more.
--
-- Stored in the database rather than in object storage, which is a deliberate
-- trade for the pilot stage and not a permanent one. Object storage is another
-- service to configure, to hold credentials for, to back up separately and to
-- have fall over; a shop receiving a few deliveries a day, with the image
-- shrunk to about 150 KB before it leaves the phone, costs a few megabytes a
-- month. Its own table, so no query that reads a document ever drags the bytes
-- along with it.
CREATE TABLE "document_photos" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_photos_pkey" PRIMARY KEY ("id")
);

-- Read as "the photos on this delivery", never any other way.
CREATE INDEX "document_photos_documentId_idx" ON "document_photos"("documentId");

ALTER TABLE "document_photos" ADD CONSTRAINT "document_photos_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
