-- A place inside a building that goods can be sent to or found in:
-- zone -> rack -> shelf -> bin. `code` is the label painted on the shelf, and
-- it is what stocks and stock_movements carry — not an id, because the address
-- is what people read out to each other, and renaming a shelf should be a
-- deliberate act rather than a silent cascade.
--
-- The empty code is reserved and never stored here: it means "arrived and not
-- put away yet", which is a state a warehouse needs to see rather than an
-- absence to hide.
CREATE TABLE "storage_bins" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "rack" TEXT NOT NULL DEFAULT '',
    "shelf" TEXT NOT NULL DEFAULT '',
    "bin" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_bins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_bins_locationId_code_key" ON "storage_bins"("locationId", "code");
CREATE INDEX "storage_bins_locationId_zone_idx" ON "storage_bins"("locationId", "zone");

ALTER TABLE "storage_bins" ADD CONSTRAINT "storage_bins_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Which bin the goods left or arrived in, so a discrepancy can be traced to a
-- shelf rather than to a building. Existing rows are all unplaced, which is
-- exactly what they were.
ALTER TABLE "stock_movements" ADD COLUMN "binLocation" TEXT NOT NULL DEFAULT '';
