import type { TariffState } from '../types';
import { TARIFF_STATE_LABELS } from '../types';

export function StatusChip({ state }: { state: TariffState }) {
  const chipClass = state === 'active' ? 'chip-active' : state === 'expired' ? 'chip-overdue' : 'chip-suspended';
  return <span className={`chip ${chipClass}`}>{TARIFF_STATE_LABELS[state]}</span>;
}
