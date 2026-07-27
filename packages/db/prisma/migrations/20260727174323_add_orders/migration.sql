-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "counterpartyId" TEXT,
ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "fulfilledBy" TEXT,
ALTER COLUMN "createdBy" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
