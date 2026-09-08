-- How a sale was actually paid for, when it was paid for in more than one way.
--
-- A customer with three thousand on the phone and the rest in cash is ordinary
-- here, and until now the only way to ring it up was as two sales: two receipts
-- neither of which can be returned against, the discount applied twice, loyalty
-- points awarded on two subtotals, and the wrong figure in the drawer.
--
-- "documents.paymentMethod" is kept and still carries the single method when
-- there is one, so every report, receipt and return written before this keeps
-- meaning exactly what it meant. Several methods stamp it 'mixed', which is
-- honest — picking the largest would file a card payment as cash.
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- Read once per sale on the receipt, and in bulk for every shift the owner
-- reconciles.
CREATE INDEX "sale_payments_documentId_idx" ON "sale_payments"("documentId");

-- One line per method per sale. Two card lines on one receipt are a slip of
-- the finger rather than two instalments, and the register refuses them — this
-- says the same thing where it cannot be bypassed.
CREATE UNIQUE INDEX "sale_payments_documentId_method_key" ON "sale_payments"("documentId", "method");

ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
