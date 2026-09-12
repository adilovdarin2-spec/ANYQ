-- Телефоны компаний и сотрудников — к тому же виду, что у контрагентов.
--
-- Это контакты, а не ключи: по ним не ищут и не сверяют. Но в админке они
-- стоят списком, по которому владелец платформы звонит, и один и тот же
-- номер, записанный «8 701 …» в одной строке и «+7 701 …» в соседней,
-- читается как два разных. Приложение теперь приводит их при записи —
-- миграция делает то же с уже записанным.

UPDATE "companies"
SET "phone" = CASE
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11 AND regexp_replace("phone", '\D', '', 'g') LIKE '8%'
    THEN '+7' || substr(regexp_replace("phone", '\D', '', 'g'), 2)
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11 AND regexp_replace("phone", '\D', '', 'g') LIKE '7%'
    THEN '+' || regexp_replace("phone", '\D', '', 'g')
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 10
    THEN '+7' || regexp_replace("phone", '\D', '', 'g')
  ELSE "phone"
END
WHERE "phone" IS NOT NULL;

UPDATE "users"
SET "phone" = CASE
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11 AND regexp_replace("phone", '\D', '', 'g') LIKE '8%'
    THEN '+7' || substr(regexp_replace("phone", '\D', '', 'g'), 2)
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 11 AND regexp_replace("phone", '\D', '', 'g') LIKE '7%'
    THEN '+' || regexp_replace("phone", '\D', '', 'g')
  WHEN length(regexp_replace("phone", '\D', '', 'g')) = 10
    THEN '+7' || regexp_replace("phone", '\D', '', 'g')
  ELSE "phone"
END
WHERE "phone" IS NOT NULL AND "phone" <> '';
