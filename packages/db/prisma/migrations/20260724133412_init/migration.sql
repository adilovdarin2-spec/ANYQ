-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariffs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "modules" TEXT NOT NULL,
    "locationLimit" INTEGER,
    "userLimit" INTEGER,
    "skuLimit" INTEGER,
    "docsPerMonthLimit" INTEGER,
    "supportLevel" TEXT NOT NULL DEFAULT 'basic',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" TEXT,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "posPin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "barcode" TEXT,
    "ntinCode" TEXT,
    "purchasePrice" INTEGER NOT NULL,
    "salePrice" INTEGER NOT NULL,
    "taxMode" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "binLocation" TEXT,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_batches" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentMethod" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_items" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "document_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "binIin" TEXT,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "prescriptionNumber" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controlled_substance_ledger" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "documentRef" TEXT,
    "loggedBy" TEXT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controlled_substance_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tariffs_companyId_key" ON "tariffs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_productId_locationId_binLocation_key" ON "stocks"("productId", "locationId", "binLocation");

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_ledger" ADD CONSTRAINT "controlled_substance_ledger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controlled_substance_ledger" ADD CONSTRAINT "controlled_substance_ledger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
