export type TariffState = 'active' | 'expired' | 'blocked' | 'missing';

export function tariffState(tariff: { blocked: boolean; validUntil: Date } | null): TariffState {
  if (!tariff) return 'missing';
  if (tariff.blocked) return 'blocked';
  if (tariff.validUntil < new Date()) return 'expired';
  return 'active';
}

export function tariffDenialMessage(state: TariffState): string {
  if (state === 'blocked') return 'Доступ заблокирован — обратитесь в поддержку';
  if (state === 'expired') return 'Срок действия тарифа истёк — обратитесь в поддержку';
  return 'Тариф не назначен — обратитесь в поддержку';
}
