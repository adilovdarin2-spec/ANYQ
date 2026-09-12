/**
 * What kind of document this is, in the register's own words.
 *
 * The server sends `typeLabel` beside `type` and must keep doing so — a
 * register in the field can be older than the server it talks to, and a type it
 * has never heard of still has to be readable. Where it does know the type,
 * this wins, because the server wrote its label in Russian without being able
 * to know what the device is set to.
 */

import type { PhraseKey } from './i18n';
import type { Translator } from './i18n/useLanguage';

const DOCUMENT_TYPE_PHRASES: Record<string, PhraseKey> = {
  sale: 'docType.sale',
  return: 'docType.return',
  receipt: 'docType.receipt',
  'write_off': 'docType.write_off',
  adjustment: 'docType.adjustment',
  transfer: 'docType.transfer',
  order: 'docType.order',
  quarantine: 'docType.quarantine',
  'bin_block': 'docType.bin_block',
  'supplier_return': 'docType.supplier_return',
  production: 'docType.production',
  'purchase_order': 'docType.purchase_order',
  reconciliation: 'docType.reconciliation',
};

export function documentTypeLabel(t: Translator['t'], type: string, serverLabel: string): string {
  const phrase = DOCUMENT_TYPE_PHRASES[type];
  return phrase ? t(phrase) : serverLabel;
}

const ORDER_STAGE_PHRASES: Record<string, PhraseKey> = {
  pending: 'stage.pending',
  picking: 'stage.picking',
  picked: 'stage.picked',
  shipped: 'stage.shipped',
  cancelled: 'stage.cancelled',
};

/** Same bargain as the document type: the code wins where the register knows it. */
export function orderStageLabel(t: Translator['t'], stage: string, serverLabel: string): string {
  const phrase = ORDER_STAGE_PHRASES[stage];
  return phrase ? t(phrase) : serverLabel;
}
