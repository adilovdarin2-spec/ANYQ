-- Коды маркировки: одна пачка — один код — один раз.
--
-- Наша половина работы: что принято, что продано. Проверку подлинности делает
-- государственная система; «дважды не продать» и «не принимали — не продашь»
-- работают локально и стоят денег каждый день.
CREATE TABLE "marked_codes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT,
    "gtin" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'in_stock',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),
    "receiptDocumentId" TEXT,
    "saleDocumentId" TEXT,
    CONSTRAINT "marked_codes_pkey" PRIMARY KEY ("id")
);

-- Уникальность держит база, а не проверка перед записью: проверка — это гонка,
-- которую две кассы выигрывают обе.
CREATE UNIQUE INDEX "marked_codes_companyId_gtin_serial_key" ON "marked_codes"("companyId", "gtin", "serial");
CREATE INDEX "marked_codes_companyId_locationId_state_idx" ON "marked_codes"("companyId", "locationId", "state");

ALTER TABLE "marked_codes" ADD CONSTRAINT "marked_codes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marked_codes" ADD CONSTRAINT "marked_codes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marked_codes" ADD CONSTRAINT "marked_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marked_codes" ADD CONSTRAINT "marked_codes_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
