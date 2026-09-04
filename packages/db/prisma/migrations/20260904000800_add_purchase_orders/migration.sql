-- When the goods are promised, on a purchase order. The date a lead time is
-- measured against, and the one that makes "late" answerable.
--
-- Purchase orders themselves reuse the documents table: type='purchase_order',
-- the supplier in counterpartyId, the delivery point in locationId, and each
-- line's receivedQuantity filled in as deliveries arrive — the same shape a
-- transfer already uses for sent-versus-arrived. A receipt line points at the
-- order line it answers through originalItemId.
ALTER TABLE "documents" ADD COLUMN "expectedAt" TIMESTAMP(3);
