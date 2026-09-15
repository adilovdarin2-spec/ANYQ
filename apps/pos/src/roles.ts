import type { PhraseKey } from './i18n';

/**
 * Роли так, как их называет сервер, и так, как их читает человек.
 *
 * Два списка, потому что имена не совпадают: у сервера роль кладовщика
 * называется `warehouse_staff`, а ключ перевода — `role.warehouse`. Пока роли
 * жили только в панели платформы, сопоставлять их в кассе было незачем; с
 * 15.09.2026 сотрудников ведёт владелец, и список ролей ему показывает касса.
 *
 * Порядок здесь — порядок в выпадающем списке, и он не алфавитный: сверху те,
 * кого заводят чаще. Кассиров в магазине больше, чем владельцев.
 */
export const ALL_ROLES = ['cashier', 'warehouse_staff', 'pharmacist', 'manager', 'owner'] as const;

export type Role = (typeof ALL_ROLES)[number];

const PHRASE: Record<string, PhraseKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  cashier: 'role.cashier',
  warehouse_staff: 'role.warehouse',
  pharmacist: 'role.pharmacist',
};

/**
 * Ключ перевода для роли — или `null`, если роль незнакомая.
 *
 * `null`, а не «неизвестная роль»: сервер мог узнать про роль, которой эта
 * сборка кассы ещё не знает, и подписать её выдумкой хуже, чем показать как
 * есть. Показывать как есть умеет вызывающий.
 */
export function rolePhrase(role: string): PhraseKey | null {
  return PHRASE[role] ?? null;
}
