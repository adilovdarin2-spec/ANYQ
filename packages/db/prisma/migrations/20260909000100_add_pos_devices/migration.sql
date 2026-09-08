-- One row per register, so a stolen tablet can be taken away on its own.
--
-- Until now the only lever was `users.tokenVersion`, which retires every
-- session that person has. A manager whose tablet was stolen had to choose
-- between leaving it live and signing the cashier out of every till in the shop
-- in the middle of a shift. A POS token lasts thirty days on purpose — the till
-- has to work through a week without a connection — so the answer to a lost
-- device cannot be a shorter token. It has to be this.
CREATE TABLE "pos_devices" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  -- Generated on the device and kept in its local storage. Identifies, never
  -- authorises: a PIN still has to be right, and knowing somebody's key buys
  -- nothing.
  "deviceKey" TEXT NOT NULL,
  -- What the owner reads in the list. Guessed from the user agent at first
  -- login and renameable, because "Android · Chrome" describes four tablets.
  "label" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Who was signed in on it last. A name in the list is what makes the row
  -- recognisable — "the one Asel uses" — rather than one cuid among four.
  "lastUserId" TEXT,
  -- Null means live. Set means: no token from this device is accepted, and it
  -- cannot log in again either. Blocking only the token would leave the thief
  -- one shoulder-surfed PIN away from being back.
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id")
);

-- Scoped to the company: two shops generating the same uuid is not a thing that
-- happens, but a key is only ever meaningful inside one tenant.
CREATE UNIQUE INDEX "pos_devices_companyId_deviceKey_key" ON "pos_devices"("companyId", "deviceKey");
CREATE INDEX "pos_devices_companyId_lastSeenAt_idx" ON "pos_devices"("companyId", "lastSeenAt");

ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
