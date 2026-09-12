-- Телефоны контрагентов — к одному виду.
--
-- По номеру ANYQ узнаёт клиента и поставщика: по нему находятся баллы, долг и
-- кредитный лимит. Сравнивался он буквально, строка со строкой, а пишут его
-- каждый раз иначе: «+7 700 123 45 67», «8 700 123 45 67», «7001234567». Для
-- базы это были три разных человека — с тремя долгами и баллами, которые не
-- находятся.
--
-- Приложение теперь приводит номер к одному виду и при записи, и при поиске
-- (apps/api/src/phone.ts). Без этой миграции правка сделала бы хуже: уже
-- записанный «+7 700 123 45 67» перестал бы находиться по нормализованному
-- ключу. Поэтому те же правила применяются к тому, что уже лежит.
--
-- Что специально не делается: строки не склеиваются. Если два контрагента
-- после нормализации оказались одним номером — значит, одного и того же
-- человека завели дважды, и решать, чей долг и чьи баллы считать настоящими,
-- должен владелец, а не миграция.
UPDATE "counterparties"
SET "phone" = CASE
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11
       AND regexp_replace("phone", '\D', '', 'g') LIKE '8%'
    THEN '+7' || substr(regexp_replace("phone", '\D', '', 'g'), 2)
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11
       AND regexp_replace("phone", '\D', '', 'g') LIKE '7%'
    THEN '+' || regexp_replace("phone", '\D', '', 'g')
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 10
    THEN '+7' || regexp_replace("phone", '\D', '', 'g')
  WHEN length(regexp_replace("phone", '\D', '', 'g')) > 11
       AND "phone" LIKE '+%'
    THEN '+' || regexp_replace("phone", '\D', '', 'g')
  ELSE "phone"
END
WHERE "phone" IS NOT NULL;

-- Поиск по номеру идёт в каждой продаже в долг и в каждой приёмке.
CREATE INDEX IF NOT EXISTS "counterparties_companyId_phone_idx"
  ON "counterparties" ("companyId", "phone");
