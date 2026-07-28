-- AlterTable
ALTER TABLE "products" ADD COLUMN     "parentProductId" TEXT,
ADD COLUMN     "variantLabel" TEXT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
