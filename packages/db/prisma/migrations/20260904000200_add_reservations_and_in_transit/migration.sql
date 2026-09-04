-- Stock promised to an open order but not yet handed over. Available to sell
-- is quantity - reserved; without it a walk-in can buy goods an online
-- customer has already been told are theirs.
ALTER TABLE "stocks" ADD COLUMN "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- What actually arrived, against the quantity that was sent. Null until the
-- document is received. A transfer that leaves with 5 and arrives with 4 is
-- what a loss in transit looks like, and it only stays visible while both
-- numbers survive.
ALTER TABLE "document_items" ADD COLUMN "receivedQuantity" DOUBLE PRECISION;

-- Transfers used to move stock out of the source and into the destination in
-- one step, so goods on a van were countable in two places at once. They now
-- sit in 'in_transit' until someone receives them. Every transfer that
-- already exists arrived under the old rules, so it is settled: mark its
-- lines received in full to keep sent-vs-received meaningful for all of them.
UPDATE "document_items" SET "receivedQuantity" = "quantity"
WHERE "documentId" IN (SELECT "id" FROM "documents" WHERE "type" = 'transfer');
