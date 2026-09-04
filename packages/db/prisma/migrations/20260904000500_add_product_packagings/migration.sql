-- The same goods arrive in one shape and leave in another: a case of 24 comes
-- in, bottles go out. Stock and the movement ledger stay in the product's base
-- unit; a packaging is only a multiplier that documents and scanners work in.
CREATE TABLE "product_packagings" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitsPerPack" DOUBLE PRECISION NOT NULL,
    "barcode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_packagings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_packagings_productId_name_key" ON "product_packagings"("productId", "name");
CREATE INDEX "product_packagings_barcode_idx" ON "product_packagings"("barcode");

ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What the person actually handled, when it wasn't loose units. The line's
-- `quantity` is always the base-unit figure these resolve to.
ALTER TABLE "document_items" ADD COLUMN "packagingId" TEXT;
ALTER TABLE "document_items" ADD COLUMN "packQuantity" DOUBLE PRECISION;
ALTER TABLE "document_items" ADD COLUMN "packPrice" INTEGER;

ALTER TABLE "document_items" ADD CONSTRAINT "document_items_packagingId_fkey"
    FOREIGN KEY ("packagingId") REFERENCES "product_packagings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
