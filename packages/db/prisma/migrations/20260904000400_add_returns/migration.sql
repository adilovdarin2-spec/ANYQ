-- Why this document exists, in the words of whoever made it. Required for a
-- return: a refund with no stated reason is the cheapest way to take money out
-- of a till.
ALTER TABLE "documents" ADD COLUMN "reason" TEXT;

-- The sale a return is against. A return standing on its own would let a
-- cashier refund goods nobody ever bought, so a return is always a claim on
-- one specific receipt and can never give back more than it sold.
ALTER TABLE "documents" ADD COLUMN "originalDocumentId" TEXT;

CREATE INDEX "documents_originalDocumentId_idx" ON "documents"("originalDocumentId");

ALTER TABLE "documents" ADD CONSTRAINT "documents_originalDocumentId_fkey"
    FOREIGN KEY ("originalDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reports and every document list read by company, then type, then date.
CREATE INDEX "documents_companyId_type_createdAt_idx" ON "documents"("companyId", "type", "createdAt");

-- What was actually handed back. Not derivable from the returned lines: a
-- refund owes a share of the discount and the points the sale collected.
ALTER TABLE "documents" ADD COLUMN "refundAmount" INTEGER;

-- The sale line a return line gives back, so the cap is per line rather than
-- per product and the goods return to the batch they left from.
ALTER TABLE "document_items" ADD COLUMN "originalItemId" TEXT;

CREATE INDEX "document_items_originalItemId_idx" ON "document_items"("originalItemId");

ALTER TABLE "document_items" ADD CONSTRAINT "document_items_originalItemId_fkey"
    FOREIGN KEY ("originalItemId") REFERENCES "document_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
