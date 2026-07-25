-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "cashierName" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "openingCash" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closingCashCounted" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
