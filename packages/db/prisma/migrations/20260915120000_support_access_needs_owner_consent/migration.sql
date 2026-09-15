-- Доступ поддержки к чужим цифрам — теперь с разрешения владельца и на время.
--
-- До сегодняшнего дня панель платформы видела выручку по сменам и каталог с
-- закупочными ценами любой компании всегда и без спроса. Это не поддержка:
-- это возможность знать, сколько зарабатывает каждый магазин и с какой
-- наценкой он работает, и владелец об этом не знал.
--
-- Совсем убрать нельзя — когда владелец звонит «не сходится выручка»,
-- разбирать вслепую тяжело, и тяжело ему же. Поэтому доступ остался, но
-- перестал быть молчаливым: его просят словами, владелец открывает сам, и он
-- закрывается через сутки без чьего-либо участия.
--
-- Отклонённые запросы хранятся наравне с разрешёнными: владелец должен видеть
-- не только то, что он разрешил, но и то, о чём его просили.
CREATE TABLE "support_access" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "support_access_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_access_companyId_requestedAt_idx" ON "support_access"("companyId", "requestedAt");

ALTER TABLE "support_access" ADD CONSTRAINT "support_access_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
