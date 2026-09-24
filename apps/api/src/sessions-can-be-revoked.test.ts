import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Любую выданную сессию можно отобрать — все три двери, без исключений.
 *
 * У продукта ровно три вида токена: платформенный аккаунт, касса и кабинет
 * владельца. Живут они долго намеренно — касса обязана работать неделю без
 * сети, — и потому вопрос «а как отобрать выданный» не теоретический.
 *
 * Отвечает на него версия доступа: токен носит номер, с которым выдан, а
 * сторона, которая его пускает, сверяет номер с текущим. Поднять номер значит
 * отозвать всё, что выдано раньше. Ровно этим гасятся старые сессии при смене
 * PIN-а, при смене пароля кабинета и при включении второго фактора.
 *
 * 16.09.2026 выяснилось, что двое из трёх это делали не полностью: кабинет не
 * поднимал версию при постановке замка, а у платформенного аккаунта версии не
 * было вовсе — его сессию нельзя было отобрать ничем. Нашлось это по очереди,
 * одним и тем же вопросом к соседу, и третий раз искать так же не хочется.
 *
 * Поэтому — не «договоримся не забывать», а проверка. Она читает исходник: за
 * этой дверью вопрос ровно такой — «носит ли токен версию и сверяет ли её
 * впускающий», — и ответить на него точнее, чем посмотрев, нельзя.
 *
 * Чего она не умеет: сказать, что версию поднимают в нужных местах. Это
 * проверяется живыми тестами — `admin-session-revocation`,
 * `cabinet-second-factor`, `staff-by-owner`. Здесь держится то, без чего те
 * проверки невозможны в принципе.
 */

const SRC = resolve(__dirname);

/** Все три двери продукта, по имени файла. Список — часть проверки. */
const DOORS = [
  { name: 'платформенный аккаунт', file: 'auth.ts' },
  { name: 'касса', file: 'pos-auth.ts' },
  { name: 'кабинет владельца', file: 'routes/cabinet.ts' },
];

function source(file: string): string {
  return withoutComments(readFileSync(resolve(SRC, file), 'utf8'));
}

/** Версия внутри собираемого объекта: `v: что-нибудь`. */
const CARRIES_VERSION = /\bv:\s*[\w.]+/;

/**
 * Сверка версии с текущей.
 *
 * Скобки и `?? 0` законны: касса так мягко пускает токены, выданные до
 * появления версии, чтобы выкатка не выгоняла из смены каждый планшет в
 * стране. Образец обязан их принимать — первый заход этой проверки на них и
 * упал, и упал зря.
 */
const CHECKS_VERSION = /tokenVersion\s*!==\s*\(?\s*[\w.]*v\b/;

/**
 * Что кладут в токен — по самому присваиванию, а не по соседним строкам.
 *
 * Первый заход смотрел на кусок файла перед `jwt.sign`, и в этот кусок
 * попадало объявление типа, где `v: number` написано всегда. Проверка была
 * зелёной и при снятой версии — то есть не проверяла ничего. Поймалось это
 * мутацией; иначе поймалось бы вторым таким же дефектом, уже в бою.
 */
function payloadAssignment(text: string): string {
  const call = text.match(/jwt\.sign\(\s*(\w+)/);
  expect(call, 'не разобрал вызов jwt.sign — проверка прошла бы вхолостую').toBeTruthy();
  const name = call![1];
  const assigned = text.match(new RegExp(`(?:const|let)\\s+${name}[^=]*=\\s*\\{[\\s\\S]*?\\};`));
  expect(assigned, `не нашёл, из чего собирают ${name}`).toBeTruthy();
  return assigned![0];
}

describe('сессии можно отобрать', () => {
  it('токен каждой двери носит версию доступа', () => {
    for (const door of DOORS) {
      expect(
        CARRIES_VERSION.test(payloadAssignment(source(door.file))),
        `${door.name} (${door.file}): в подписываемом токене нет версии доступа — ` +
          'значит выданный токен нельзя отозвать ничем, и он проживёт весь свой срок',
      ).toBe(true);
    }
  });

  it('и впускающий сверяет её с текущей', () => {
    for (const door of DOORS) {
      const text = source(door.file);
      expect(
        CHECKS_VERSION.test(text.slice(text.indexOf('jwt.verify'))),
        `${door.name} (${door.file}): версия в токене не сверяется с текущей — ` +
          'поднимать её тогда бессмысленно, старые сессии всё равно работают',
      ).toBe(true);
    }
  });

  it('и дверей ровно три — четвёртая должна попасть сюда же', () => {
    // Слабое место такой проверки не ложная тревога, а пропуск: новый токен,
    // подписанный в новом файле, просто не попадёт в список выше, и проверка
    // продолжит проходить.
    const all = [
      'auth.ts',
      'pos-auth.ts',
      'routes/cabinet.ts',
      'routes/pos.ts',
      'routes/auth.ts',
      'routes/supply.ts',
      'app.ts',
    ];
    const signing = all.filter((file) => source(file).includes('jwt.sign'));
    expect(signing.sort()).toEqual(DOORS.map((d) => d.file).sort());
  });

  it('а сама проверка умеет сказать «нет»', () => {
    // Иначе всё выше проходило бы и на сломанном разборе — именно так первый
    // заход и проходил.
    const without = "const payload: T = { type: 'admin', sub: id };\n  return jwt.sign(payload, S);";
    expect(CARRIES_VERSION.test(payloadAssignment(without))).toBe(false);

    const with_ = "const payload: T = { type: 'admin', sub: id, v: version };\n  return jwt.sign(payload, S);";
    expect(CARRIES_VERSION.test(payloadAssignment(with_))).toBe(true);

    expect(CHECKS_VERSION.test('jwt.verify(raw, S);\n  req.userId = payload.sub;')).toBe(false);
    expect(CHECKS_VERSION.test('if (!user || user.tokenVersion !== (payload.v ?? 0)) {')).toBe(true);
    expect(CHECKS_VERSION.test('if (cabinet.tokenVersion !== payload.v) {')).toBe(true);
  });
});
