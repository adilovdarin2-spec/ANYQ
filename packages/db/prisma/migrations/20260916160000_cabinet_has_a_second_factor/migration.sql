-- Второй фактор у кабинета владельца.
--
-- Кабинет был дверью только на чтение, и замка ему хватало одного. Управление
-- PIN-ами сотрудников это меняет: украденный адрес стал бы входом в кассу.
ALTER TABLE "owner_cabinets" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "owner_cabinets" ADD COLUMN "pendingTotpSecret" TEXT;
ALTER TABLE "owner_cabinets" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);

CREATE TABLE "cabinet_recovery_codes" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cabinet_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cabinet_recovery_codes_cabinetId_idx" ON "cabinet_recovery_codes"("cabinetId");

ALTER TABLE "cabinet_recovery_codes" ADD CONSTRAINT "cabinet_recovery_codes_cabinetId_fkey"
    FOREIGN KEY ("cabinetId") REFERENCES "owner_cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
