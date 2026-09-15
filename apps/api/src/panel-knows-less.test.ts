import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Панель платформы знает о чужом магазине только то, за что мы берём деньги.
 *
 * Черта проведена 15.09.2026 и держится ни на чём, кроме дисциплины: следующий
 * маршрут, дописанный в `routes/companies.ts`, может вернуть что угодно, и
 * заметить это будет некому. Раньше здесь заводили и правили чужих сотрудников
 * поимённо, вместе с PIN-ами, — а PIN на платформе уникален и ищется без
 * компании, то есть это была рабочая связка ключей от любой кассы.
 *
 * Теперь тарифы делятся на количество сотрудников, и количество — это всё, что
 * мы о них знаем. Список ведёт владелец у себя в кассе: `routes/pos.ts`,
 * `staff-by-owner.test.ts`.
 *
 * Одно панель делать обязана: вручить владельцу первый PIN и перевыдать
 * потерянный. Без этого новый магазин не откроется, а забывший PIN не войдёт.
 *
 * Проверяется исходником. Приём грубый, но вопрос ровно такой: «что этот файл
 * может узнать и записать о чужих людях», и ответить на него точнее, чем
 * посмотрев, нельзя. Живое поведение — в `integration/admin-sees-less.test.ts`.
 */
const SOURCE = readFileSync(resolve(__dirname, 'routes/companies.ts'), 'utf8');

function routeDeclarations(): { method: string; path: string }[] {
  return [...SOURCE.matchAll(/companiesRouter\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)].map((m) => ({
    method: m[1],
    path: m[2],
  }));
}

const WRITE_METHODS = /^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

/**
 * Каждое обращение к таблице людей вместе с телом вызова.
 *
 * Скобки считаются, а не описываются регулярным выражением: вызовы бывают и в
 * одну строку, и в десять, а «до закрывающей скобки» в однопроходном поиске
 * склеивает соседние — см. самопроверку ниже.
 */
function userCalls(): { method: string; args: string }[] {
  const found: { method: string; args: string }[] = [];
  for (const match of SOURCE.matchAll(/(?:prisma|tx)\.user\.(\w+)\(/g)) {
    const from = match.index! + match[0].length;
    let i = from;
    let depth = 1;
    while (i < SOURCE.length && depth > 0) {
      if (SOURCE[i] === '(') depth += 1;
      else if (SOURCE[i] === ')') depth -= 1;
      i += 1;
    }
    found.push({ method: match[1], args: SOURCE.slice(from, i - 1) });
  }
  return found;
}

/**
 * Единственный маршрут панели, который вообще что-то делает с человеком.
 *
 * Назван поимённо, а не описан правилом вроде «про сотрудников можно PIN»:
 * правило разрешит и то, что допишут под этим путём завтра, а список — нет.
 */
const OWNER_PIN_ROUTE = '/:id/owner-pin';

describe('панель и чужие сотрудники', () => {
  it('не имеет ни одного маршрута про сотрудников, кроме PIN владельца', () => {
    const aboutPeople = routeDeclarations()
      .map((r) => r.path)
      .filter((path) => /user|staff|pin|employee/i.test(path));
    expect(aboutPeople).toEqual([OWNER_PIN_ROUTE]);
  });

  it('и охрана не пустая: маршруты в этом файле вообще находятся', () => {
    // Самопроверка. Сломайся разбор — список выше стал бы пустым, а пустой
    // список проходит проверку «ничего лишнего» с блеском и ничего не значит.
    expect(routeDeclarations().length).toBeGreaterThan(5);
  });

  it('пишет о человеке ровно одно — PIN владельца', () => {
    const writes = userCalls().filter((c) => WRITE_METHODS.test(c.method));
    expect(writes.map((c) => c.method)).toEqual(['update']);
    // Кроме самого PIN-а меняется только `tokenVersion` — это и есть «старый
    // PIN перестал работать», а не отдельное поле про человека.
    const fields = writes[0].args.match(/data:\s*\{([^}]*)/)?.[1] ?? '';
    expect(fields).toContain('posPin');
    expect(fields).not.toMatch(/\bname\b|\brole\b|\bphone\b/);
  });

  it('и разбор аргументов не врёт: чтения тоже видны, и у них есть тело', () => {
    // Самопроверка с историей. Первая версия этой охраны искала вызов и его
    // аргументы одним регулярным выражением с ленивым «до закрывающей скобки»
    // — и однопроходный поиск, начав с однострочного `findFirst`, проглатывал
    // вместе с ним всю запись PIN-а: запись переставала быть видна, а проверка
    // «пишем только PIN» зеленела, ничего не проверив. Теперь скобки
    // считаются, и вот доказательство, что считаются.
    const calls = userCalls();
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.filter((c) => !WRITE_METHODS.test(c.method)).length).toBeGreaterThan(0);
    expect(calls.every((c) => c.args.includes('where'))).toBe(true);
  });

  it('создавая компанию, заводит владельца — и больше никого', () => {
    // Вложенный `users: { create: [...] }` внутри `company.create` — не
    // `prisma.user.create`, поэтому проверка выше его не видит. Он нужен:
    // компания без владельца никому не принадлежит. Но ровно один.
    const nested = [...SOURCE.matchAll(/users:\s*\{\s*create:\s*\[([\s\S]*?)\]\s*\}/g)];
    expect(nested).toHaveLength(1);
    expect(nested[0][1].match(/role:/g) ?? []).toHaveLength(1);
    expect(nested[0][1]).toContain("role: 'owner'");
  });

  it('читает сотрудников только ради счёта — из базы приходит один id', () => {
    // Имя, которого не запрашивали, невозможно случайно отдать наружу.
    const select = SOURCE.match(/users:\s*\{\s*select:\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(select.trim().replace(/,$/, '')).toBe('id: true');
  });

  it('и отдаёт число, а не список', () => {
    expect(SOURCE).toContain('count: company.users.length');
    expect(SOURCE).not.toContain('company.users.map');
  });
});
