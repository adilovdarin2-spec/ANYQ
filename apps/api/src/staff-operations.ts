import { prisma } from '@anyq/db';
import type { AuditActor } from './audit-log';
import { recordChanges } from './audit-log';
import { lastOwnerRefusal, selfRoleRefusal } from './staff';
import { roleRefusal } from './roles';
import { limitRefusal } from './limits';
import { phoneKey } from './phone';

/**
 * Что делают с сотрудником — в одном месте на оба входа.
 *
 * Сотрудников заводят из кассы, а с 16.09.2026 ещё и из кабинета владельца.
 * Это два очень разных входа: касса — терминал в магазине с PIN-ом, кабинет —
 * ссылка в телефоне, запертая паролем и вторым фактором. Но правила про самих
 * людей у них обязаны быть одни: тот же запрет понизить последнего владельца,
 * та же проверка PIN-а на занятость, тот же сброс токенов при смене доступа,
 * та же запись в журнал.
 *
 * Написать их дважды — значит однажды поправить одно и не поправить второе. В
 * этом проекте такое находилось уже трижды за двое суток, и каждый раз цена
 * была выше, чем стоил бы общий модуль.
 *
 * Отказы возвращаются значением, а не бросаются: у каждого свой код ответа, и
 * маршрут обязан их различать, а не переводить всё в «что-то пошло не так».
 */

export type StaffRefusal = { ok: false; status: number; error: string };
export type StaffSuccess<T> = { ok: true; value: T };
export type StaffOutcome<T> = StaffSuccess<T> | StaffRefusal;

export interface StaffView {
  id: string;
  name: string;
  role: string;
  phone: string;
  hasPin: boolean;
}

/** Четыре-шесть цифр: столько кассир согласен набирать по сто раз в день. */
export const STAFF_PIN_PATTERN = /^\d{4,6}$/;
export const STAFF_PIN_TAKEN = 'Этот PIN уже используется другим сотрудником';

/**
 * PIN не отдаётся даже владельцу его собственного магазина.
 *
 * Он задаётся и забывается: карточка сотрудника открывается на чужом экране
 * чаще, чем кажется, а прочитать PIN — значит войти кассой этого человека.
 */
export function serializeStaff(u: {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  posPin: string | null;
}): StaffView {
  return { id: u.id, name: u.name, role: u.role, phone: u.phone ?? '', hasPin: u.posPin !== null };
}

/**
 * PIN уникален на всю платформу, а не внутри компании.
 *
 * `/pos/login` ищет его без компании — кассиру негде набрать, в каком он
 * магазине. Значит столкновение возможно и с чужим магазином, и ответить на
 * него надо словами про PIN, а не «внутренняя ошибка».
 */
export function isStaffPinConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002' &&
    JSON.stringify((err as { meta?: unknown }).meta ?? '').includes('posPin')
  );
}

export async function listStaff(companyId: string): Promise<{ users: StaffView[]; limit: number | null }> {
  const [users, company] = await Promise.all([
    prisma.user.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
    prisma.company.findUnique({ where: { id: companyId }, include: { tariff: true } }),
  ]);
  return { users: users.map(serializeStaff), limit: company?.tariff?.userLimit ?? null };
}

export interface StaffInput {
  name?: unknown;
  role?: unknown;
  phone?: unknown;
  posPin?: unknown;
  clearPin?: unknown;
}

export async function createStaff(
  companyId: string,
  actor: AuditActor,
  b: StaffInput,
): Promise<StaffOutcome<StaffView>> {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || !b.role) return { ok: false, status: 400, error: 'Заполните имя и роль' };

  const badRole = roleRefusal(b.role);
  if (badRole) return { ok: false, status: 400, error: badRole };

  const posPin = typeof b.posPin === 'string' ? b.posPin.trim() : '';
  if (posPin && !STAFF_PIN_PATTERN.test(posPin)) {
    return { ok: false, status: 400, error: 'PIN должен быть числом из 4–6 цифр' };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { tariff: true, _count: { select: { users: true } } },
  });
  const refusal = limitRefusal('users', company?.tariff?.userLimit, company?._count.users ?? 0);
  if (refusal) return { ok: false, status: 409, error: refusal };

  if (posPin) {
    const clash = await prisma.user.findFirst({ where: { posPin } });
    if (clash) return { ok: false, status: 409, error: STAFF_PIN_TAKEN };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId,
          name,
          role: b.role as string,
          phone: phoneKey(typeof b.phone === 'string' ? b.phone : null) || null,
          posPin: posPin || null,
        },
      });
      // Заведение нового: сравнивать не с чем, поэтому «до» — пустая карточка.
      await recordChanges(tx, actor, { entity: 'user', entityId: user.id, entityName: name, before: {}, after: user });
      return user;
    });
    return { ok: true, value: serializeStaff(created) };
  } catch (err) {
    // Второй владелец успел занять этот PIN между проверкой и записью.
    if (!isStaffPinConflict(err)) throw err;
    return { ok: false, status: 409, error: STAFF_PIN_TAKEN };
  }
}

export async function updateStaff(
  companyId: string,
  actor: AuditActor,
  /**
   * Кто правит, если он сам сотрудник этой компании.
   *
   * Из кассы это кассир за терминалом, и ему нельзя понизить самого себя. Из
   * кабинета правит владелец, которого в списке сотрудников может не быть
   * вовсе — он входит ссылкой, а не PIN-ом, — и тогда запрета «на себя» нет,
   * потому что нет и «себя». Запрет на последнего владельца остаётся в обоих
   * случаях: он про компанию, а не про того, кто нажал.
   */
  actingUserId: string | null,
  id: string,
  b: StaffInput,
): Promise<StaffOutcome<StaffView>> {
  const existing = await prisma.user.findFirst({ where: { id, companyId } });
  if (!existing) return { ok: false, status: 404, error: 'Сотрудник не найден' };

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || !b.role) return { ok: false, status: 400, error: 'Заполните имя и роль' };

  const badRole = roleRefusal(b.role);
  if (badRole) return { ok: false, status: 400, error: badRole };

  // Два способа запереть себя из собственной кассы — см. `staff.ts`.
  const staff = await prisma.user.findMany({ where: { companyId }, select: { id: true, role: true } });
  const locked =
    (actingUserId ? selfRoleRefusal(actingUserId, existing.id, existing.role, b.role as string) : null) ??
    lastOwnerRefusal(staff, existing.id, b.role as string);
  if (locked) return { ok: false, status: 409, error: locked };

  // Пустое поле значит «не трогать», а не «снять»: прочитать прежний PIN
  // нельзя, и правка имени не должна молча отбирать у кассира кассу. Снятие
  // говорится отдельно — та же причина, что и в панели платформы.
  const posPin = typeof b.posPin === 'string' ? b.posPin.trim() : '';
  const clearPin = b.clearPin === true;
  if (posPin && clearPin) {
    return { ok: false, status: 400, error: 'Либо новый PIN, либо снятие доступа — не одновременно' };
  }
  if (posPin && !STAFF_PIN_PATTERN.test(posPin)) {
    return { ok: false, status: 400, error: 'PIN должен быть числом из 4–6 цифр' };
  }
  if (posPin && posPin !== existing.posPin) {
    const clash = await prisma.user.findFirst({ where: { posPin, id: { not: existing.id } } });
    if (clash) return { ok: false, status: 409, error: STAFF_PIN_TAKEN };
  }
  const nextPin = clearPin ? null : posPin || existing.posPin;

  // Новый PIN или новая роль — это тот момент, когда выданный токен должен
  // перестать работать. Переименование — нет: оно не выгоняет человека из
  // смены.
  const accessChanged = b.role !== existing.role || nextPin !== existing.posPin;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: existing.id },
        data: {
          name,
          role: b.role as string,
          phone: phoneKey(typeof b.phone === 'string' ? b.phone : null) || null,
          posPin: nextPin,
          ...(accessChanged ? { tokenVersion: { increment: 1 } } : {}),
        },
      });
      await recordChanges(tx, actor, {
        entity: 'user',
        entityId: user.id,
        entityName: existing.name,
        before: existing,
        after: user,
      });
      return user;
    });
    return { ok: true, value: serializeStaff(updated) };
  } catch (err) {
    if (!isStaffPinConflict(err)) throw err;
    return { ok: false, status: 409, error: STAFF_PIN_TAKEN };
  }
}
