-- Who moved it. A reason and a document say what happened; only this says
-- who did it, which is the question actually being asked when a shortage
-- turns up. Nullable: rows written before it existed have no answer, and
-- neither does a storefront customer, who has no user account.
ALTER TABLE "stock_movements" ADD COLUMN "createdBy" TEXT;

-- The stock history screen reads this back newest-first per location.
CREATE INDEX "stock_movements_locationId_createdAt_idx" ON "stock_movements"("locationId", "createdAt");
