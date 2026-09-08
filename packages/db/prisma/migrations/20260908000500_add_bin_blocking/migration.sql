-- Blocking a whole shelf rather than a product.
--
-- Quarantine worked per product at a location, which covers a suspect batch and
-- not the case a warehouse actually hits: a pallet was dropped, a shelf got wet,
-- a zone is being held for an inspection. Everything on that shelf stops being
-- sellable at once, whatever it is.
--
-- "blockedAt" on the bin is the visible state; the amounts are held in the
-- existing "blocked" column on stock, so availability arithmetic is unchanged
-- and nothing downstream has to learn about bins.
ALTER TABLE "storage_bins" ADD COLUMN "blockedAt" TIMESTAMP(3);
ALTER TABLE "storage_bins" ADD COLUMN "blockedReason" TEXT;

-- Which shelf a document is about. Null for everything that is not about one
-- shelf in particular.
--
-- Needed so unblocking releases exactly what this block held, and not a product
-- somebody quarantined separately for a different reason. Without it the two
-- kinds of hold are indistinguishable in the "blocked" column and releasing one
-- silently releases the other.
ALTER TABLE "documents" ADD COLUMN "binLocation" TEXT;
