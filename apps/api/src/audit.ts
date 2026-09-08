/**
 * Who changed what, and to what.
 *
 * Every movement of goods already carries an author, a reason and a document.
 * Prices did not. That is the wrong way round for a shop: quietly dropping a
 * price, selling to a friend and putting it back is easier than carrying
 * anything out of the door, leaves no shortage behind, and until now left no
 * trace at all. The same is true of granting somebody a credit limit or making
 * them a manager.
 *
 * The log is written for the owner reading it weeks later, not for a machine.
 * That shapes two decisions:
 *
 *  - **Names are copied in, not looked up.** A row that renders as "—" because
 *    the person was deleted is useless exactly when it matters most, which is
 *    when investigating somebody who has left.
 *
 *  - **Nothing is recorded unless it changed.** A log with a row for every time
 *    somebody opened a form and pressed save is a log nobody reads, and an
 *    unread log protects no one.
 */

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** A field whose value is never written down, only the fact that it moved. */
const SECRET_FIELDS = new Set(['posPin']);

function normalise(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return String(value);
}

/**
 * What actually changed, among the fields worth watching.
 *
 * Compared as text on purpose: a form sends "1290" where the database holds the
 * number 1290, and treating those as a change would fill the log with edits
 * nobody made.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  watched: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of watched) {
    const from = normalise(before[field]);
    const to = normalise(after[field]);
    if (from === to) continue;
    if (SECRET_FIELDS.has(field)) {
      // The fact, never the value. An audit log that leaks the credential it
      // is auditing is worse than no audit log, because it is trusted.
      changes.push({ field, before: null, after: null });
      continue;
    }
    changes.push({ field, before: from, after: to });
  }
  return changes;
}

export const WATCHED_FIELDS = {
  product: ['name', 'salePrice', 'purchasePrice', 'barcode', 'ntinCode', 'taxMode', 'sellable', 'stopListed'],
  user: ['role', 'posPin', 'name'],
  counterparty: ['creditAllowed', 'creditLimit'],
} as const;

export type AuditEntity = keyof typeof WATCHED_FIELDS;

const FIELD_LABELS: Record<string, string> = {
  name: 'название',
  salePrice: 'цена продажи',
  purchasePrice: 'закупочная цена',
  barcode: 'штрихкод',
  ntinCode: 'код НКТ',
  taxMode: 'режим НДС',
  sellable: 'в продаже',
  stopListed: 'стоп-лист',
  role: 'роль',
  posPin: 'PIN-код',
  creditAllowed: 'разрешён долг',
  creditLimit: 'лимит долга',
};

const ENTITY_LABELS: Record<AuditEntity, string> = {
  product: 'Товар',
  user: 'Сотрудник',
  counterparty: 'Контрагент',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity as AuditEntity] ?? entity;
}

/**
 * One line an owner can read without knowing the schema.
 *
 * Written out rather than left as a before/after pair of columns, because the
 * question being asked of this log is "what happened", and a person scanning
 * for something odd reads sentences faster than they read a table.
 */
export function describeChange(entity: string, entityName: string, change: FieldChange): string {
  const what = `${entityLabel(entity)} «${entityName}»`;
  if (SECRET_FIELDS.has(change.field)) return `${what}: ${fieldLabel(change.field)} изменён`;
  if (change.before === null) return `${what}: ${fieldLabel(change.field)} — задано «${change.after}»`;
  if (change.after === null) return `${what}: ${fieldLabel(change.field)} — снято (было «${change.before}»)`;
  return `${what}: ${fieldLabel(change.field)} — «${change.before}» → «${change.after}»`;
}

/**
 * Whether a change is one an owner should be shown before the others.
 *
 * A log where everything is equally important is a log nobody finishes. These
 * are the three that move money without moving goods: what a thing sells for,
 * who is allowed to change that, and who may take goods without paying.
 */
export function isSensitive(entity: string, field: string): boolean {
  if (entity === 'product' && field === 'salePrice') return true;
  if (entity === 'user' && (field === 'role' || field === 'posPin')) return true;
  if (entity === 'counterparty') return true;
  return false;
}

export interface PriceMove {
  entityId: string;
  entityName: string;
  actorName: string;
  before: number;
  after: number;
  at: Date;
}

/**
 * A price lowered and put back within a short window, by the same person.
 *
 * The shape of the oldest trick in retail, and the one thing here worth
 * surfacing on its own rather than leaving in a list to be noticed. Two
 * ordinary edits either side of a sale look like nothing in a log; together
 * they are a question worth asking.
 */
export function findPriceRoundTrips(moves: PriceMove[], windowMs = 24 * 60 * 60 * 1000): PriceMove[][] {
  const byProduct = new Map<string, PriceMove[]>();
  for (const move of moves) {
    const list = byProduct.get(move.entityId) ?? [];
    list.push(move);
    byProduct.set(move.entityId, list);
  }

  const found: PriceMove[][] = [];
  for (const list of byProduct.values()) {
    const ordered = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i < ordered.length; i += 1) {
      const down = ordered[i];
      if (down.after >= down.before) continue;
      for (let j = i + 1; j < ordered.length; j += 1) {
        const up = ordered[j];
        if (up.at.getTime() - down.at.getTime() > windowMs) break;
        // Back to where it started, by the same hand. A different person
        // putting a price back is somebody correcting a mistake, which is the
        // system working rather than a question to ask.
        if (up.after === down.before && up.actorName === down.actorName) {
          found.push([down, up]);
          break;
        }
      }
    }
  }
  return found;
}
