-- Кабинет владельца: своя ссылка и свой пароль, отдельно от касс.
--
-- Одна строка на компанию. passwordHash пустой до первого захода владельца —
-- до этого по ссылке не видно ничего, кроме названия компании.
CREATE TABLE "owner_cabinets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordSetAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_cabinets_pkey" PRIMARY KEY ("id")
);

-- Уникальность секрета — это не удобство, а условие: две компании за одной
-- ссылкой означали бы, что владелец видит чужую выручку. Пусть лучше запись
-- упадёт.
CREATE UNIQUE INDEX "owner_cabinets_companyId_key" ON "owner_cabinets"("companyId");
CREATE UNIQUE INDEX "owner_cabinets_secret_key" ON "owner_cabinets"("secret");

ALTER TABLE "owner_cabinets" ADD CONSTRAINT "owner_cabinets_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
