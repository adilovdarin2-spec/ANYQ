/**
 * One line of the change log, said by the register rather than the server.
 *
 * The server writes this sentence too, and sends it as `text`. It has to: a
 * register three versions old, or the admin panel, has no idea what
 * `creditLimit` is called. But a sentence assembled on the server is a sentence
 * in the server's language, and the server does not know which one the device
 * is set to.
 *
 * So the parts come across — who, what, which field, from what to what — and
 * the register puts them in its own order with its own words. Anything it does
 * not recognise falls back to the server's sentence, which is Russian and
 * correct, rather than to a gap.
 */

import type { PhraseKey } from './i18n';
import type { Translator } from './i18n/useLanguage';
import type { AuditEntry } from './types';

const ENTITY_PHRASES: Record<string, PhraseKey> = {
  product: 'audit.entity.product',
  user: 'audit.entity.user',
  counterparty: 'audit.entity.counterparty',
};

const FIELD_PHRASES: Record<string, PhraseKey> = {
  name: 'audit.field.name',
  salePrice: 'audit.field.salePrice',
  purchasePrice: 'audit.field.purchasePrice',
  barcode: 'audit.field.barcode',
  ntinCode: 'audit.field.ntinCode',
  taxMode: 'audit.field.taxMode',
  sellable: 'audit.field.sellable',
  stopListed: 'audit.field.stopListed',
  role: 'audit.field.role',
  posPin: 'audit.field.posPin',
  creditAllowed: 'audit.field.creditAllowed',
  creditLimit: 'audit.field.creditLimit',
};

/**
 * A boolean crossed the wire as a word, because that is what the log stored.
 *
 * Storing "да" rather than true was the right call — the log has to stay
 * readable years after the field is gone — but it means the value arrives in
 * Russian, and translating it back is the price of that.
 */
function value(t: Translator['t'], raw: string): string {
  if (raw === 'да') return t('audit.yes');
  if (raw === 'нет') return t('audit.no');
  return raw;
}

export function describeAuditEntry(t: Translator['t'], entry: AuditEntry): string {
  const entity = ENTITY_PHRASES[entry.entity];
  const field = FIELD_PHRASES[entry.field];
  // An entry about something this version has never heard of. The server's own
  // sentence is the better answer: it was written by code that did know.
  if (!entity || !field) return entry.text;

  const what = t('audit.subject', { entity: t(entity), name: entry.entityName });
  const which = t(field);

  // A secret field arrives with both sides blank on purpose — the log records
  // that the PIN moved, never what it moved to.
  if (entry.before === null && entry.after === null) {
    return t('audit.changed', { what, field: which });
  }
  if (entry.before === null) {
    return t('audit.set', { what, field: which, after: value(t, entry.after ?? '') });
  }
  if (entry.after === null) {
    return t('audit.cleared', { what, field: which, before: value(t, entry.before) });
  }
  return t('audit.moved', {
    what,
    field: which,
    before: value(t, entry.before),
    after: value(t, entry.after),
  });
}
