-- AlterTable
ALTER TABLE "document_items" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "saleUnit" TEXT NOT NULL DEFAULT 'piece';

-- AlterTable
ALTER TABLE "stocks" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;
