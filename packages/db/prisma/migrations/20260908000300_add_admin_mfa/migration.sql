-- A second factor on the account that can change every price, every role and
-- every credit limit in every company on the platform. A password alone on
-- that account is the whole platform's security, and passwords are reused.
--
-- Two secret columns, not one. "pendingTotpSecret" holds a setup somebody
-- started and has not confirmed with a working code; only a confirmed secret
-- moves to "totpSecret". Without the split, an owner who scans a QR and then
-- closes the tab has locked themselves out of their own account.
ALTER TABLE "admin_users" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "admin_users" ADD COLUMN "pendingTotpSecret" TEXT;
ALTER TABLE "admin_users" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);

-- For the day the phone is lost. Without these, losing a phone means losing
-- the account, and an owner locked out at seven in the morning will demand the
-- second factor be switched off — which is how a security feature ends up
-- making things worse than it found them.
--
-- Hashed, because they are passwords. A recovery code in plain text is a
-- password in plain text with a longer name.
CREATE TABLE "admin_recovery_codes" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    -- Set the moment it is spent. Single use is the whole point: a code that
    -- works twice is a password that survived being written on paper.
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_recovery_codes_adminUserId_idx" ON "admin_recovery_codes"("adminUserId");

ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
