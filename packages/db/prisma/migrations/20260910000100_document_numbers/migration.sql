-- Номер документа: ПРХ-2026-000123.
--
-- До этого номера не было вообще, и это ровно тот пункт, на котором бухгалтер
-- клиента говорит «нет». Документ без номера нельзя ни назвать в разговоре, ни
-- сослаться на него в акте, ни найти в выгрузке.
--
-- Номер присваивает триггер, а не приложение. Причина не в любви к триггерам:
-- документы создаются в двадцати четырёх местах кода, и двадцать пятое,
-- написанное через месяц, про нумерацию забудет. Триггер забыть нельзя.
-- Он же выполняется внутри той же транзакции, что и сам документ, поэтому
-- два одновременных чека не получат один номер.
--
-- Нумерация отдельная по компании, типу и году — так, как её ведёт бухгалтерия:
-- приёмки нумеруются своей чередой, продажи своей, и каждый январь начинается
-- с единицы.

CREATE TABLE "document_counters" (
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("companyId", "type", "year")
);

ALTER TABLE "documents" ADD COLUMN "number" TEXT;

-- Приставка по типу документа — то, что бухгалтер читает как «приход» или
-- «списание», не открывая карточку. Список продублирован из
-- DOCUMENT_TYPE_LABELS в apps/api/src/routes/pos.ts, и это дублирование
-- охраняется тестом: apps/api/src/document-number.test.ts читает этот файл и
-- падает, если появился тип без приставки.
CREATE FUNCTION document_number_prefix(doc_type TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN CASE doc_type
    WHEN 'sale'            THEN 'ПРД'
    WHEN 'return'          THEN 'ВЗВ'
    WHEN 'receipt'         THEN 'ПРХ'
    WHEN 'write_off'       THEN 'СПС'
    WHEN 'adjustment'      THEN 'ИНВ'
    WHEN 'transfer'        THEN 'ПРМ'
    WHEN 'order'           THEN 'ЗАК'
    WHEN 'quarantine'      THEN 'КРН'
    WHEN 'bin_block'       THEN 'БЛК'
    WHEN 'supplier_return' THEN 'ВЗП'
    WHEN 'production'      THEN 'ПРЗ'
    WHEN 'purchase_order'  THEN 'ЗКП'
    -- Неизвестный тип получает свои первые три буквы в верхнем регистре, а не
    -- ничего: документ без номера хуже документа с некрасивым номером, и в
    -- этом случае тест уже упал на сборке.
    ELSE upper(substring(doc_type from 1 for 3))
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION assign_document_number() RETURNS TRIGGER AS $$
DECLARE
  doc_year INTEGER;
  seq INTEGER;
BEGIN
  -- Номер, переданный явно, не трогаем: перенос из старой системы должен уметь
  -- сохранить чужую нумерацию.
  IF NEW."number" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  doc_year := EXTRACT(YEAR FROM COALESCE(NEW."createdAt", now()))::INTEGER;

  INSERT INTO "document_counters" ("companyId", "type", "year", "last")
  VALUES (NEW."companyId", NEW."type", doc_year, 1)
  ON CONFLICT ("companyId", "type", "year")
  DO UPDATE SET "last" = "document_counters"."last" + 1
  RETURNING "last" INTO seq;

  NEW."number" := document_number_prefix(NEW."type") || '-' || doc_year || '-' || lpad(seq::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_assign_number
  BEFORE INSERT ON "documents"
  FOR EACH ROW EXECUTE FUNCTION assign_document_number();

-- Уже существующие документы нумеруются задним числом, по порядку создания.
-- Оставить их без номера значило бы завести две породы документов, и первый же
-- бухгалтер спросил бы, почему у половины номера нет.
WITH ordered AS (
  SELECT
    "id",
    "companyId",
    "type",
    EXTRACT(YEAR FROM "createdAt")::INTEGER AS doc_year,
    row_number() OVER (
      PARTITION BY "companyId", "type", EXTRACT(YEAR FROM "createdAt")
      ORDER BY "createdAt", "id"
    ) AS seq
  FROM "documents"
)
UPDATE "documents" d
SET "number" = document_number_prefix(o."type") || '-' || o.doc_year || '-' || lpad(o.seq::TEXT, 6, '0')
FROM ordered o
WHERE d."id" = o."id";

-- И счётчики подводятся к тому, что уже роздано, иначе следующий документ
-- получил бы номер, который уже занят.
INSERT INTO "document_counters" ("companyId", "type", "year", "last")
SELECT "companyId", "type", EXTRACT(YEAR FROM "createdAt")::INTEGER, count(*)::INTEGER
FROM "documents"
GROUP BY "companyId", "type", EXTRACT(YEAR FROM "createdAt")
ON CONFLICT ("companyId", "type", "year") DO UPDATE SET "last" = EXCLUDED."last";

-- Два документа одной компании под одним номером — это то, чего не должно
-- случиться никогда. Пусть лучше упадёт запись.
CREATE UNIQUE INDEX "documents_companyId_number_key" ON "documents"("companyId", "number");
