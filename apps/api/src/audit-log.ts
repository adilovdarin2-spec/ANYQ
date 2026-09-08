import { prisma, Prisma } from '@anyq/db';
import { diffFields, WATCHED_FIELDS } from './audit';
import type { AuditEntity } from './audit';

export interface AuditActor {
  companyId: string;
  actorId: string | null;
  actorName: string;
}

interface RecordOptions {
  entity: AuditEntity;
  entityId: string;
  /** As it reads now. Copied into every row, so the log survives a rename. */
  entityName: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Writes down what changed, if anything did.
 *
 * Takes a transaction client where the caller has one, so the change and the
 * record of it commit together. A log written afterwards is a log that is
 * missing exactly the entries that mattered — the ones where something went
 * wrong halfway.
 *
 * Returns how many rows it wrote, which is nearly always zero: most saves
 * change nothing.
 */
export async function recordChanges(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  options: RecordOptions,
): Promise<number> {
  const changes = diffFields(options.before, options.after, [...WATCHED_FIELDS[options.entity]]);
  if (changes.length === 0) return 0;

  await tx.auditEntry.createMany({
    data: changes.map((change) => ({
      companyId: actor.companyId,
      entity: options.entity,
      entityId: options.entityId,
      entityName: options.entityName,
      field: change.field,
      before: change.before,
      after: change.after,
      actorId: actor.actorId,
      actorName: actor.actorName,
    })),
  });
  return changes.length;
}

/**
 * The name to write against a change, resolved once at the point of the change.
 *
 * A missing user is recorded as such rather than left blank: "неизвестно" is a
 * fact about the record, and an empty column is a question about the code.
 */
export async function resolveActor(companyId: string, userId: string | null | undefined): Promise<AuditActor> {
  if (!userId) return { companyId, actorId: null, actorName: 'неизвестно' };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { companyId, actorId: userId, actorName: user?.name ?? 'неизвестно' };
}
