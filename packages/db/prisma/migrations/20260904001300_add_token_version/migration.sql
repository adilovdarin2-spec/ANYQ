-- Bumped whenever a person's access changes — a new PIN, a new role, or an
-- outright revocation. Tokens carry the version they were minted at, so
-- raising it retires every token already in the wild.
--
-- Without it a POS token lasts its full thirty days whatever happens to the
-- account: changing a departing cashier's PIN stops them logging in again and
-- does nothing at all to the token already on their phone.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
