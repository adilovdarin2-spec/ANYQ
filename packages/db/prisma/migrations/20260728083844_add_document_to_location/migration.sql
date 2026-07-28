-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "toLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
