-- Reading a whole location's stock is the commonest query in the product: the
-- sale grid, every availability check, the bin map and the order list.
CREATE INDEX "stocks_locationId_idx" ON "stocks"("locationId");

-- Every debt figure starts from "what has this counterparty been charged".
CREATE INDEX "documents_counterpartyId_type_idx" ON "documents"("counterpartyId", "type");

-- The debt screens list customers or suppliers, never both.
CREATE INDEX "counterparties_companyId_type_idx" ON "counterparties"("companyId", "type");
