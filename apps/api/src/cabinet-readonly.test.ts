import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

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
const SOURCE = withoutComments(readFileSync(resolve(__dirname, 'routes/cabinet.ts'), 'utf8'));

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
 * Маршруты за токеном кабинета, которым позволено не быть GET.
 *
 * Перечислены поимённо, а не описаны правилом вроде «всё под /session можно»:
 * правило разрешает и то, что напишут под этим путём завтра, а список — нет.
 * Новый пишущий маршрут упадёт здесь, и это ровно тот момент, когда нужно
 * подумать, а не дописать.
 *
 * До 16.09.2026 список был из одного пункта. Потом владелец решил, что PIN-ы
 * сотрудников он хочет вести из кабинета, и черта передвинулась — но вместе с
 * замком: PIN-ы доступны только при включённом втором факторе, и это условие
 * проверяется отдельным тестом ниже, потому что оно и есть вся защита.
 */
const WRITING_ROUTES = [
  '/session/support/:id/:action',
  '/session/security/setup',
  '/session/security/enable',
  '/session/security/disable',
  '/session/staff',
  '/session/staff/:id',
];

/** Маршруты, за которыми стоят чужие PIN-ы. Без второго фактора — никак. */
const STAFF_ROUTES = ['/session/staff', '/session/staff/:id'];

describe('кабинет владельца не трогает бизнес', () => {
  it('пишет только тем, что перечислено поимённо', () => {
    const writing = routeDeclarations()
      .filter((route) => route.guards.includes('requireCabinet'))
      .filter((route) => route.method !== 'get')
      .map((route) => route.path);
    expect([...new Set(writing)].sort()).toEqual([...WRITING_ROUTES].sort());
  });

  it('и каждый маршрут про PIN-ы заперт вторым фактором', () => {
    // Главная строчка файла. PIN даёт то, чего у кабинета не было никогда:
    // поменял кассиру, вошёл этим PIN-ом, торгуешь от чужого имени. Проверка
    // замка стоит внутри обработчика, а не в списке охранников, — значит
    // ищется в теле, и ищется у каждого.
    // Разбором, а не одной регуляркой: тело обработчика многострочно, и
    // выражение, которое его ловит, само становится тем, что надо проверять.
    const chunks = SOURCE.split('cabinetRouter.').slice(1);
    const staff = chunks
      .map((chunk) => ({
        method: chunk.slice(0, chunk.indexOf('(')),
        path: chunk.slice(chunk.indexOf("'") + 1, chunk.indexOf("'", chunk.indexOf("'") + 1)),
        body: chunk,
      }))
      .filter((route) => STAFF_ROUTES.includes(route.path));
    expect(staff.length, 'маршруты про PIN-ы не разобрались — проверка прошла бы вхолостую').toBe(3);
    for (const route of staff) {
      expect(route.body, `${route.method.toUpperCase()} ${route.path} без второго фактора`).toContain(
        'requireSecondFactor',
      );
    }
  });

  it('и записи в самом файле касаются только доступа, а не торговли', () => {
    // `ownerCabinet` — пароль, отметка о входе и сам второй фактор.
    // `cabinetRecoveryCode` — одноразовые коды к нему. `supportAccess` — ответ
    // владельца на просьбу посмотреть. Товар, цена, остаток, продажа за этой
    // дверью писаться не могут, и если однажды смогут, сломается здесь.
    const models = [...SOURCE.matchAll(WRITE_CALLS)].map((m) => m[1]);
    expect([...new Set(models)].sort()).toEqual([
      'cabinetRecoveryCode',
      'ownerCabinet',
      'supportAccess',
    ]);
  });

  it('и ничего из того, чем магазин торгует', () => {
    // Отдельной строкой и по именам: список выше — это «что есть», а это —
    // «чего быть не должно». Первый меняется вместе с кодом, второй нет.
    //
    // `user` из этого списка ушёл 16.09.2026 — осознанно, вместе с решением
    // владельца, — и на его место встала проверка замка выше. Остальные
    // остаются: кабинет не торгует.
    const models = new Set([...SOURCE.matchAll(WRITE_CALLS)].map((m) => m[1]));
    for (const forbidden of ['product', 'stock', 'document', 'stockMovement', 'tariff', 'counterparty']) {
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
