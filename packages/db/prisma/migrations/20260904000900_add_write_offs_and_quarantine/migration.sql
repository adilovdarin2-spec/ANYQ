-- Physically here, on the books, and not for sale: quarantined pending a
-- decision. Pretending blocked goods are gone understates stock; leaving them
-- sellable sells them. Available becomes quantity - reserved - blocked.
ALTER TABLE "stocks" ADD COLUMN "blocked" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- The countable half of a write-off's reason: 'damage', 'expiry', 'theft',
-- 'quality', 'other'. Free text alone cannot answer "do we lose more to
-- breakage or to expiry"; a code can, and the note explains the instance.
--
-- Write-offs themselves reuse the documents table with type='write_off'.
ALTER TABLE "documents" ADD COLUMN "reasonCode" TEXT;
