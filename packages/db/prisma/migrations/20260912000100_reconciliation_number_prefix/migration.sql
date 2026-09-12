-- Приставка для документа сверки журнала.
--
-- Такой документ пишет починка остатков, и типа `reconciliation` в списке
-- приставок не было: он попадал в ветку ELSE и получал номер вида
-- REC-2026-000001 — латиница посреди нумерации, которую бухгалтер читает
-- глазами. Ошибка тихая: номер есть, документ есть, и заметить это можно
-- только посмотрев на список документов.
--
-- Функция заменяется целиком, а не дополняется: в Postgres иначе нельзя, и
-- копия списка здесь — та самая, что охраняется тестом
-- apps/api/src/document-number.test.ts. Тест читает последнее определение
-- функции среди миграций, то есть это.
CREATE OR REPLACE FUNCTION document_number_prefix(doc_type TEXT) RETURNS TEXT AS $$
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
    WHEN 'reconciliation'  THEN 'СВР'
    -- Неизвестный тип получает свои первые три буквы в верхнем регистре, а не
    -- ничего: документ без номера хуже документа с некрасивым номером, и в
    -- этом случае тест уже упал на сборке.
    ELSE upper(substring(doc_type from 1 for 3))
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Уже выданные REC-номера переписываются на СВР. Их могло быть ноль — кнопку
-- починки на боевом никто не нажимал, — но если где-то есть, два написания
-- одного и того же типа хуже, чем одно некрасивое.
UPDATE "documents"
SET "number" = 'СВР' || substring("number" from 4)
WHERE "type" = 'reconciliation' AND "number" LIKE 'REC-%';
