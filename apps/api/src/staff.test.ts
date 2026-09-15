import { describe, it, expect } from 'vitest';
import { lastOwnerRefusal, selfRemovalRefusal, selfRoleRefusal } from './staff';
import type { StaffMember } from './staff';

/**
 * Три способа запереть себя из собственной кассы, и почему их не было раньше.
 *
 * Пока сотрудников заводили только из панели ANYQ, ни один из них не был
 * возможен: администратор платформы не входит в компанию и запереть себя в ней
 * не может. Владелец может — и с 15.09.2026 список сотрудников ведёт он.
 */

const staff = (...roles: string[]): StaffMember[] =>
  roles.map((role, i) => ({ id: `u${i + 1}`, role }));

describe('последний владелец', () => {
  it('не понижается', () => {
    // Иначе в компании не остаётся никого, кто может это отменить: сотрудников
    // заводит только владелец.
    expect(lastOwnerRefusal(staff('owner', 'cashier'), 'u1', 'cashier')).toContain('владелец');
  });

  it('а при втором владельце — понижается', () => {
    // Компания остаётся с владельцем, значит отменить есть кому.
    expect(lastOwnerRefusal(staff('owner', 'owner'), 'u1', 'manager')).toBeNull();
  });

  it('владелец, остающийся владельцем, правилу не мешает', () => {
    // Смена имени или телефона роли не трогает.
    expect(lastOwnerRefusal(staff('owner'), 'u1', 'owner')).toBeNull();
  });

  it('и не владельца оно не касается', () => {
    expect(lastOwnerRefusal(staff('owner', 'cashier'), 'u2', 'manager')).toBeNull();
  });

  it('незнакомый человек — не наше дело', () => {
    // Такого в компании нет; ответит на это маршрут своим 404, а не это правило.
    expect(lastOwnerRefusal(staff('owner'), 'нет-такого', 'cashier')).toBeNull();
  });
});

describe('своя роль', () => {
  it('не меняется', () => {
    expect(selfRoleRefusal('u1', 'u1', 'owner', 'manager')).toContain('Свою роль');
  });

  it('чужая — меняется', () => {
    expect(selfRoleRefusal('u1', 'u2', 'cashier', 'manager')).toBeNull();
  });

  it('и «поменял на ту же» — не смена', () => {
    // Сохранение карточки без правки роли не должно упираться в отказ.
    expect(selfRoleRefusal('u1', 'u1', 'owner', 'owner')).toBeNull();
  });

  it('закрывает и путь наверх', () => {
    // Если список однажды откроют менеджеру, «сделать себя владельцем» должно
    // остаться невозможным без этого правила.
    expect(selfRoleRefusal('u9', 'u9', 'manager', 'owner')).toBeTruthy();
  });
});

describe('удаление себя', () => {
  it('запрещено', () => {
    expect(selfRemovalRefusal('u1', 'u1')).toContain('Себя');
  });

  it('а чужое — нет', () => {
    expect(selfRemovalRefusal('u1', 'u2')).toBeNull();
  });
});
