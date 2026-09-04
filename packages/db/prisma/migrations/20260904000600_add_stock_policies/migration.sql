-- How much of a product a particular point wants to keep. Per location, not per
-- product: a warehouse holding a month of cover and the shop it feeds holding
-- three days are the same goods with different answers.
CREATE TABLE "stock_policies" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "minQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_policies_productId_locationId_key" ON "stock_policies"("productId", "locationId");
CREATE INDEX "stock_policies_locationId_idx" ON "stock_policies"("locationId");

ALTER TABLE "stock_policies" ADD CONSTRAINT "stock_policies_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_policies" ADD CONSTRAINT "stock_policies_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
