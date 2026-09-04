-- Whether an account may take goods away without paying, and how far. The
-- permission itself: a cashier can let a regular the owner has set up buy on
-- credit, and cannot open an account for a phone number typed at the counter.
-- A limit of 0 means "no ceiling set", not "no credit".
ALTER TABLE "counterparties" ADD COLUMN "creditAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "counterparties" ADD COLUMN "creditLimit" INTEGER NOT NULL DEFAULT 0;

-- Money moving between the company and somebody it deals with. Kept apart from
-- documents deliberately: a payment settles documents, and one payment can
-- settle several.
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "documentId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "settlements_companyId_counterpartyId_createdAt_idx" ON "settlements"("companyId", "counterpartyId", "createdAt");
CREATE INDEX "settlements_documentId_idx" ON "settlements"("documentId");

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_counterpartyId_fkey"
    FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
