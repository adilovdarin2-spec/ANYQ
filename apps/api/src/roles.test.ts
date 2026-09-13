import { describe, it, expect } from 'vitest';
import { can, capabilityRefusal, KNOWN_ROLES, roleRefusal } from './roles';
import type { Capability } from './roles';

/**
 * Кто может изменить остаток, не пробивая чек.
 *
 * Это не про иерархию ради иерархии. Списание и инвентаризация — единственные
 * две операции, которыми недостача превращается в норму задним числом: «списал
 * двадцать бутылок как бой» и «пересчитал, было девяносто». Всё остальное
 * оставляет след, который сходится с деньгами.
 *
 * Обратная сторона проверяется отдельно и она важнее: роль не должна мешать
 * торговать. Продажа, возврат и смена — не способность, а работа, и их здесь
 * нет вовсе.
 */

const ВСЕ: Capability[] = ['receive', 'moveStock', 'count', 'writeOff', 'produce'];

describe('что может роль', () => {
  it('владелец и менеджер — всё', () => {
    for (const роль of ['owner', 'manager']) {
      for (const c of ВСЕ) expect(can(роль, c), `${роль}/${c}`).toBe(true);
    }
  });

  it('кладовщик работает со складом, но не списывает', () => {
    // Получить, разместить, собрать, переместить, пересчитать — его работа.
    for (const c of ['receive', 'moveStock', 'count', 'produce'] as Capability[]) {
      expect(can('warehouse_staff', c), c).toBe(true);
    }
    // А списание — это убыток, и его подписывает старший.
    expect(can('warehouse_staff', 'writeOff')).toBe(false);
  });

  it('кассир не трогает склад', () => {
    for (const c of ВСЕ) expect(can('cashier', c), c).toBe(false);
  });

  it('неизвестная роль не получает ничего', () => {
    // Новая роль, о которой таблица ещё не знает, должна упереться в отказ, а
    // не получить права владельца по умолчанию.
    for (const c of ВСЕ) {
      expect(can('supervisor', c), c).toBe(false);
      expect(can(null, c), c).toBe(false);
      expect(can(undefined, c), c).toBe(false);
      expect(can('', c), c).toBe(false);
    }
  });
});

describe('отказ', () => {
  it('молчит, когда можно', () => {
    expect(capabilityRefusal('owner', 'writeOff')).toBeNull();
    expect(capabilityRefusal('warehouse_staff', 'count')).toBeNull();
  });

  it('называет тех, к кому идти', () => {
    // «Недостаточно прав» — тупик: человек стоит перед задачей, которую ему
    // поручили, и не знает, кого звать.
    expect(capabilityRefusal('cashier', 'writeOff')).toBe('Списание проводит владелец или менеджер');
    expect(capabilityRefusal('warehouse_staff', 'writeOff')).toContain('владелец или менеджер');
    expect(capabilityRefusal('cashier', 'count')).toContain('кладовщик');
  });

  it('у каждой способности есть свой текст', () => {
    // Общий текст на все случаи означал бы, что человек читает одно и то же
    // предложение в пяти разных тупиках.
    const тексты = ВСЕ.map((c) => capabilityRefusal('cashier', c));
    expect(new Set(тексты).size).toBe(ВСЕ.length);
    for (const текст of тексты) expect(текст?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('роль, которой нет', () => {
  // Роль — это не подпись в карточке: по ней считаются права. Опечатка не даёт
  // ничего и выглядит настоящей ролью: в карточке написано «cashir», человек
  // упирается в отказы, и найти причину можно только чтением базы.
  it('называется и показывает настоящие', () => {
    const refusal = roleRefusal('cashir');
    expect(refusal).toContain('cashier');
    expect(refusal).toContain('Такой роли нет');
  });

  it('настоящие роли проходят', () => {
    for (const role of KNOWN_ROLES) expect(roleRefusal(role), role).toBeNull();
  });

  it('пустая роль — тоже отказ', () => {
    expect(roleRefusal('')).toBeTruthy();
    expect(roleRefusal(undefined)).toBeTruthy();
    expect(roleRefusal(7)).toBeTruthy();
  });
});
