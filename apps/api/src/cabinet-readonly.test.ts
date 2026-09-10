import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Кабинет только читает — и это должно оставаться правдой завтра.
 *
 * Утверждение «изменить здесь нельзя ничего» написано владельцу на экране и
 * стоит в основании всей конструкции: именно поэтому украденная ссылка с
 * паролем — неприятность, а не катастрофа. Держится оно ни на чём, кроме
 * дисциплины: следующий маршрут, дописанный в этот файл, может писать что
 * угодно, и никто не заметит.
 *
 * Поэтому проверяется исходником. Читать код тестом — приём грубый, но здесь
 * вопрос ровно такой: «есть ли за этой дверью хоть одна операция записи», и
 * ответить на него точнее, чем посмотрев, нельзя.
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

describe('кабинет владельца только читает', () => {
  it('за токеном кабинета нет ни одного пишущего маршрута', () => {
    const writing = routeDeclarations()
      .filter((route) => route.guards.includes('requireCabinet'))
      .filter((route) => route.method !== 'get');
    expect(writing).toEqual([]);
  });

  it('и записи в файле касаются только самого кабинета', () => {
    // Две записи законны: пароль при первой настройке и отметка о последнем
    // входе. Всё остальное — товар, цена, продажа — за этой дверью писаться не
    // может, и если однажды сможет, сломается здесь.
    const models = [...SOURCE.matchAll(WRITE_CALLS)].map((m) => m[1]);
    expect([...new Set(models)]).toEqual(['ownerCabinet']);
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
