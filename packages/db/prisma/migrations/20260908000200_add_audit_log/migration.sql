-- Who changed what, and to what.
--
-- Every movement of goods already carries an author, a reason and a document.
-- Prices did not, which is the wrong way round for a shop: quietly dropping a
-- price, selling to a friend and putting it back is easier than carrying
-- anything out of the door, leaves no shortage behind, and left no trace at
-- all. The same goes for granting a credit limit or making somebody a manager.
--
-- "actorName" and "entityName" are copies, not lookups. A row that renders as
-- "—" because the person was deleted is useless exactly when it matters most,
-- which is when looking into somebody who has left.
CREATE TABLE "audit_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    -- Null on both sides for a secret, where only the fact that it moved is
    -- recorded. An audit log that leaks the credential it audits is worse than
    -- none, because it is trusted.
    "before" TEXT,
    "after" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- The log is read newest-first for one company, which is the only way it is
-- ever read.
CREATE INDEX "audit_entries_companyId_createdAt_idx" ON "audit_entries"("companyId", "createdAt");

-- And, when a particular thing is under question, by that thing.
CREATE INDEX "audit_entries_entity_entityId_idx" ON "audit_entries"("entity", "entityId");

ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
