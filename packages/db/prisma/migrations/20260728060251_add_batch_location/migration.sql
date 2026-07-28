/*
  Warnings:

  - Added the required column `locationId` to the `product_batches` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "product_batches" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "locationId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "product_batches_productId_locationId_idx" ON "product_batches"("productId", "locationId");

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
