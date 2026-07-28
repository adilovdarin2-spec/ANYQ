-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "pointsEarned" INTEGER,
ADD COLUMN     "pointsRedeemed" INTEGER;
