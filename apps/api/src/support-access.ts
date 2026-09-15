/**
 * Можно ли сейчас смотреть чужие цифры — и если нет, то почему.
 *
 * Правило вынесено из маршрута, потому что оно решает, увидит ли сотрудник
 * платформы выручку чужого магазина. Такое решение должно быть проверяемым без
 * поднятого сервера и без базы: одна функция, один вход, один ответ.
 *
 * Состояний у разрешения пять, и все пять — разные ответы владельцу, а не
 * оттенки одного отказа.
 */

export interface SupportGrant {
  grantedAt: Date | null;
  expiresAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
}

export type SupportState =
  /** Никто не просил. */
  | 'none'
  /** Попросили, владелец ещё не ответил. */
  | 'pending'
  /** Владелец отказал. */
  | 'declined'
  /** Владелец открыл и передумал раньше срока. */
  | 'revoked'
  /** Сутки прошли — доступ закрылся сам. */
  | 'expired'
  /** Открыт прямо сейчас. */
  | 'active';

/**
 * Сколько живёт разрешение.
 *
 * Сутки — потому что звонок «у меня не сходится выручка» редко решается за
 * один заход: посмотрели, перезвонили, попросили пересчитать кассу, посмотрели
 * снова. Час заставлял бы просить заново посреди разговора, и владелец
 * привыкал бы нажимать «разрешить» не читая, — а разрешение, которое дают не
 * глядя, не разрешение.
 *
 * Неделя — уже не «помогите разобраться», а постоянный доступ с лишним шагом.
 */
export const GRANT_HOURS = 24;

export function grantState(grant: SupportGrant | null, now: Date): SupportState {
  if (!grant) return 'none';
  if (grant.declinedAt) return 'declined';
  if (grant.revokedAt) return 'revoked';
  if (!grant.grantedAt || !grant.expiresAt) return 'pending';
  return grant.expiresAt > now ? 'active' : 'expired';
}

/** Открыт ли доступ прямо сейчас. */
export function isOpen(grant: SupportGrant | null, now: Date): boolean {
  return grantState(grant, now) === 'active';
}

/**
 * Отказ словами — тем, кто просил.
 *
 * Разные состояния значат разное действие: у «ещё не ответил» ждут, у
 * «отказал» не просят снова тем же вечером, у «истёк» просят заново. Один
 * ответ «нет доступа» на все случаи заставляет угадывать.
 */
export function refusalFor(state: SupportState): string {
  if (state === 'pending') return 'Владелец ещё не ответил на запрос';
  if (state === 'declined') return 'Владелец отказал в доступе';
  if (state === 'revoked') return 'Владелец закрыл доступ';
  if (state === 'expired') return 'Доступ истёк — запросите заново';
  return 'Нужно разрешение владельца: запросите доступ и объясните, зачем';
}

/** До какого момента действует разрешение, выданное сейчас. */
export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + GRANT_HOURS * 60 * 60 * 1000);
}

/**
 * Причина запроса — обязательна и не бывает пустой отговоркой.
 *
 * Владелец решает по этой строке и больше ни по чему. «Проверка» и «нужно» —
 * это не причина, а способ не объяснять; короткий минимум заставляет написать
 * хотя бы предложение.
 */
export const MIN_REASON = 10;

export function reasonRefusal(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Объясните владельцу, зачем нужен доступ';
  }
  if (value.trim().length < MIN_REASON) {
    return 'Напишите причину целиком — владелец решает по ней';
  }
  return null;
}
