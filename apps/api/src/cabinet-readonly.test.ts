import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Кабинет не трогает бизнес — и это должно оставаться правдой завтра.
 *
 * Обещание написано владельцу на экране и стоит в основании всей конструкции:
 * именно поэтому украденная ссылка с паролем — неприятность, а не катастрофа.
 * Держится оно ни на чём, кроме дисциплины: следующий маршрут, дописанный в
 * этот файл, может писать что угодно, и никто не заметит.
 *
 * До 15.09.2026 обещание звучало короче — «изменить здесь нельзя ничего», — и
 * проверялось так же коротко: за токеном кабинета не было ни одного маршрута,
 * кроме GET. Потом появилось согласие на доступ поддержки, и решать его должен
 * владелец там, где он сидит один, — то есть здесь.
 *
 * Поэтому черта проведена заново и точнее. Кабинет по-прежнему не может
 * изменить ничего в самом магазине: ни товар, ни цену, ни остаток, ни продажу.
 * Решить он может ровно две вещи — свой собственный пароль и то, пускать ли
 * нас посмотреть. Обе про доступ, ни одна про торговлю.
 *
 * Разница для укравшего ссылку: он и раньше мог прочитать цифры магазина, а
 * теперь может ещё разрешить прочитать их нам. Это не путь к чему-то, чего у
 * него нет; за товар и деньги по-прежнему отвечает касса.
 *
 * Проверяется исходником. Читать код тестом — приём грубый, но вопрос здесь
 * ровно такой: «что за этой дверью можно записать», и ответить на него
 * точнее, чем посмотрев, нельзя.
 */
const SOURCE = readFileSync(resolve(__dirname, 'routes/cabinet.ts'), 'utf8');

/** Всё, чем Prisma пишет. */
const WRITE_CALLS = /(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;

function routeDeclarations(): { method: string; path: string; guards: string }[] {
  return [...SOURCE.matchAll(/cabinetRouter\.(\w+)\(\s*'([^']+)'\s*,([^)]*?)async/gs)].map((m) => ({
    method: m[1],
    path: m[2],
    guards: m[3],
  }));
}

/**
 * Единственный маршрут за токеном кабинета, которому позволено не быть GET.
 *
 * Перечислен поимённо, а не описан правилом вроде «всё под /support можно»:
 * правило разрешает и то, что напишут под этим путём завтра, а список — нет.
 * Новый пишущий маршрут упадёт здесь, и это ровно тот момент, когда нужно
 * подумать, а не дописать.
 */
const CONSENT_ROUTE = '/session/support/:id/:action';

describe('кабинет владельца не трогает бизнес', () => {
  it('единственная запись за токеном кабинета — согласие на доступ', () => {
    const writing = routeDeclarations()
      .filter((route) => route.guards.includes('requireCabinet'))
      .filter((route) => route.method !== 'get')
      .map((route) => route.path);
    expect(writing).toEqual([CONSENT_ROUTE]);
  });

  it('и записи в файле касаются только доступа, а не торговли', () => {
    // `ownerCabinet` — пароль при первой настройке и отметка о последнем
    // входе. `supportAccess` — ответ владельца на просьбу посмотреть. Товар,
    // цена, остаток, продажа за этой дверью писаться не могут, и если однажды
    // смогут, сломается здесь.
    const models = [...SOURCE.matchAll(WRITE_CALLS)].map((m) => m[1]);
    expect([...new Set(models)].sort()).toEqual(['ownerCabinet', 'supportAccess']);
  });

  it('и ничего из того, чем магазин торгует', () => {
    // Отдельной строкой и по именам: список выше — это «что есть», а это —
    // «чего быть не должно». Первый меняется вместе с кодом, второй нет.
    const models = new Set([...SOURCE.matchAll(WRITE_CALLS)].map((m) => m[1]));
    for (const forbidden of ['product', 'stock', 'document', 'stockMovement', 'user', 'tariff', 'counterparty']) {
      expect(models.has(forbidden), `кабинет пишет в ${forbidden}`).toBe(false);
    }
  });

  it('разбирает все маршруты файла, а не сколько-то из них', () => {
    // Слабое место такого теста — не ложная тревога, а пропуск: маршрут,
    // который выражение не разобрало, молча выпадает из проверки, и проверка
    // продолжает проходить. Поэтому счёт разобранного сверяется со счётом
    // упоминаний роутера в файле.
    const declared = [...SOURCE.matchAll(/cabinetRouter\.\w+\(/g)].length;
    const parsed = routeDeclarations().length;
    expect(parsed).toBe(declared);
    expect(parsed).toBeGreaterThanOrEqual(5);
    expect(routeDeclarations().some((route) => route.guards.includes('requireCabinet'))).toBe(true);
  });

  it('открытие ссылки не считается попыткой входа', () => {
    // Иначе владелец, обновивший кабинет десять раз, запирал сам себя
    // сообщением «слишком много попыток входа», ничего не введя.
    const status = routeDeclarations().find((route) => route.method === 'get' && route.path === '/:secret');
    expect(status?.guards).toContain('cabinetProbeRateLimit');
    expect(status?.guards).not.toContain('loginRateLimit');
  });

  it('а ввод пароля — считается', () => {
    const guessable = routeDeclarations().filter((route) => route.path.endsWith('/login') || route.path.endsWith('/password'));
    expect(guessable.length).toBe(2);
    for (const route of guessable) expect(route.guards).toContain('loginRateLimit');
  });
});
