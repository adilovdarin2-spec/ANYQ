-- The registered cash register a point sells through. One per location: a ККМ
-- is registered to a place, not to a company. No credentials are stored here —
-- a provider API key needs encryption at rest and a key custodian, so until
-- that exists it lives in the deployment environment.
CREATE TABLE "fiscal_devices" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'none',
    "registrationNumber" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_devices_locationId_key" ON "fiscal_devices"("locationId");

ALTER TABLE "fiscal_devices" ADD CONSTRAINT "fiscal_devices_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A printed POS slip is not a fiscal receipt until a registered device or its
-- operator confirms it. One row per sale, so a retry registers the same
-- receipt rather than a second one.
CREATE TABLE "fiscal_receipts" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "fiscalNumber" TEXT,
    "fiscalSign" TEXT,
    "registeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_receipts_documentId_key" ON "fiscal_receipts"("documentId");
CREATE INDEX "fiscal_receipts_status_createdAt_idx" ON "fiscal_receipts"("status", "createdAt");

ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
