-- The id the register generated when the shift was opened. Stable from that
-- moment whether or not there was a network, whereas "id" is the server's key
-- and does not exist until the shift reaches it — so a sale rung offline has
-- nothing else to point at.
--
-- Unique per company, which is also what makes opening a shift safe to retry:
-- a second attempt finds the first rather than opening a second shift with its
-- own opening float. Postgres treats NULLs as distinct, so the rows that
-- predate this column do not collide with each other.
ALTER TABLE "shifts" ADD COLUMN "clientCommandId" TEXT;

CREATE UNIQUE INDEX "shifts_companyId_clientCommandId_key" ON "shifts"("companyId", "clientCommandId");
