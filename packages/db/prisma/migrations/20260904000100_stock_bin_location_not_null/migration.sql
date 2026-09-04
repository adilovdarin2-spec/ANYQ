-- Stock has a unique index on (productId, locationId, binLocation), but in
-- Postgres two NULLs are never equal, so every row the app writes today (it
-- never sets a bin) sits outside that constraint. Two concurrent first
-- receipts of the same product could create two rows for one product at one
-- location, and the read path — a Map keyed by productId — would then keep
-- one arbitrary row and silently ignore the other's quantity forever.
--
-- Making the column NOT NULL with '' meaning "no bin yet" puts every row
-- under the existing unique index. Any duplicate rows already created by that
-- race are merged into the earliest row first, summing their quantities, so
-- the total on hand is preserved and still matches the movement ledger.

UPDATE "stocks" s
SET "quantity" = totals."totalQuantity"
FROM (
    SELECT MIN("id") AS "keepId", SUM("quantity") AS "totalQuantity"
    FROM "stocks"
    WHERE "binLocation" IS NULL
    GROUP BY "productId", "locationId"
    HAVING COUNT(*) > 1
) AS totals
WHERE s."id" = totals."keepId";

DELETE FROM "stocks" s
USING (
    SELECT "id", MIN("id") OVER (PARTITION BY "productId", "locationId") AS "keepId"
    FROM "stocks"
    WHERE "binLocation" IS NULL
) AS dupes
WHERE s."id" = dupes."id" AND dupes."id" <> dupes."keepId";

UPDATE "stocks" SET "binLocation" = '' WHERE "binLocation" IS NULL;

ALTER TABLE "stocks" ALTER COLUMN "binLocation" SET DEFAULT '';
ALTER TABLE "stocks" ALTER COLUMN "binLocation" SET NOT NULL;
