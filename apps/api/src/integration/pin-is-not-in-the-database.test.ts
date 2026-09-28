import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import { pinFingerprint, looksLikeFingerprint } from '../pin';

/**
 * PIN-а кассира в базе нет.
 *
 * Модель данных обещала «PIN-хэш» с первого дня. В базе лежали сами цифры:
 * `select "posPin" from users` возвращал `1111`, `2223`, `5679` — PIN-ы всех
 * магазинов платформы, читаемые глазами.
 *
 * Дорого это не потому, что PIN — пароль. Он не пароль: четыре цифры, набранные
 * на виду у очереди. Дорого потому, что PIN — единственный ключ к кассе: по нему
 * продают, возвращают, списывают товар и открывают отчёты владельца. Одна
 * утёкшая выгрузка — и это есть у всех, без подбора и сразу по всей платформе.
 *
 * Теперь в колонке лежит HMAC с общим секретом. Одинаковый для одного PIN-а —
 * значит уникальность на платформе работает как работала; бесполезный без
 * секрета, которого в выгрузке базы нет.
 */

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 10 });
});

describe('PIN в базе', () => {
  it('не равен тому, что набирает кассир', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    expect(user.posPin, 'PIN лежит в базе как есть').not.toBe(fx.pin);
    expect(user.posPin && looksLikeFingerprint(user.posPin)).toBe(true);
  });

  it('и его цифр в колонке не найти ничем', async () => {
    /* Проверяется поиском по подстроке, а не сравнением: подпись, случайно
       оставившая PIN внутри себя, сравнение бы прошла. */
    const все = await prisma.user.findMany({ select: { posPin: true } });
    expect(все.length).toBeGreaterThan(0);
    for (const { posPin } of все) {
      if (!posPin) continue;
      expect(posPin.includes(fx.pin), `цифры PIN-а видны в «${posPin}»`).toBe(false);
    }
  });

  it('а войти по нему по-прежнему можно', async () => {
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('и по отпечатку вместо PIN-а — нельзя', async () => {
    /* Иначе тот, кто прочитал базу, входил бы прямо тем, что в ней написано, и
       вся подпись не стоила бы ничего. */
    const login = await api(null, 'POST', '/pos/login', { pin: pinFingerprint(fx.pin) });
    expect(login.status, 'вход отпечатком принят').toBe(401);
  });

  it('PIN, заданный владельцем через кассу, тоже подписан', async () => {
    const created = await api(fx.token, 'POST', '/pos/users', {
      name: 'Кассир',
      role: 'cashier',
      posPin: '901234',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(saved.posPin).toBe(pinFingerprint('901234'));

    const login = await api(null, 'POST', '/pos/login', { pin: '901234' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('и заменённый — тоже', async () => {
    const created = await api(fx.token, 'POST', '/pos/users', {
      name: 'Кассир',
      role: 'cashier',
      posPin: '901234',
    });
    const changed = await api(fx.token, 'PATCH', `/pos/users/${created.body.id}`, {
      name: 'Кассир',
      role: 'cashier',
      posPin: '905678',
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(saved.posPin).toBe(pinFingerprint('905678'));
    expect((await api(null, 'POST', '/pos/login', { pin: '905678' })).status).toBe(200);
    expect((await api(null, 'POST', '/pos/login', { pin: '901234' })).status).toBe(401);
  });
});

describe('PIN, записанный до подписи', () => {
  /* Ветка перехода. Без неё выкладка оставила бы без входа всех, кто уже
     работает: в колонке лежат цифры, а сервер ищет отпечаток. «Выдайте всем
     PIN-ы заново» — это магазин, который утром не открылся. */

  it('принимается один раз и тут же заменяется отпечатком', async () => {
    await prisma.user.update({ where: { id: fx.userId }, data: { posPin: '778899' } });

    const login = await api(null, 'POST', '/pos/login', { pin: '778899' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    expect(after.posPin, 'старое значение осталось в базе').toBe(pinFingerprint('778899'));
  });

  it('и следующий вход идёт уже по отпечатку', async () => {
    await prisma.user.update({ where: { id: fx.userId }, data: { posPin: '778899' } });
    await api(null, 'POST', '/pos/login', { pin: '778899' });

    const again = await api(null, 'POST', '/pos/login', { pin: '778899' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it('но чужой PIN этой веткой не подобрать', async () => {
    // Ветка ищет точное совпадение, а не «что-нибудь похожее».
    await prisma.user.update({ where: { id: fx.userId }, data: { posPin: '778899' } });
    expect((await api(null, 'POST', '/pos/login', { pin: '778898' })).status).toBe(401);
    expect((await api(null, 'POST', '/pos/login', { pin: '77889' })).status).toBe(401);
  });
});

describe('переход не сталкивает двух человек на одном PIN-е', () => {
  /* Дыра, найденная в собственной переходной ветке до выкладки.
  
     У кассира A в базе лежат цифры `1234`. Владелец другой компании заводит
     себе `1234`; проверка занятости ищет отпечаток, старого A не видит и
     разрешает. Утром A приходит, вход находит его по цифрам и пытается заменить
     их отпечатком — а отпечаток уже занят. Уникальность в базе честная, запись
     падает, и падает она на кассире, который ничего не делал.
  
     Поэтому занятость проверяется по обоим видам записи сразу. */

  it('занятым считается и PIN, записанный цифрами', async () => {
    const theirs = await createFixture();
    await prisma.user.update({ where: { id: fx.userId }, data: { posPin: '515151' } });

    const clash = await api(theirs.token, 'POST', '/pos/users', {
      name: 'Второй кассир',
      role: 'cashier',
      posPin: '515151',
    });
    expect(clash.status, 'PIN выдали второму человеку').toBe(409);
  });

  it('и тот, кто его набирает, входит собой, а не тем вторым', async () => {
    /* Проверяется, кто именно вошёл, а не только код ответа.
    
       Первая версия этого теста смотрела на 200 — и проходила при сломанной
       проверке занятости, но по страшной причине: второму человеку PIN
       выдавали, его запись оказывалась подписанной, вход находил по отпечатку
       **его**, отвечал 200 и пускал кассира A в чужую компанию. Тест на код
       ответа такое пропускает, а это хуже отказа. */
    const theirs = await createFixture();
    await prisma.user.update({ where: { id: fx.userId }, data: { posPin: '515151' } });
    await api(theirs.token, 'POST', '/pos/users', { name: 'Второй', role: 'cashier', posPin: '515151' });

    const login = await api(null, 'POST', '/pos/login', { pin: '515151' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.user.id, 'PIN впустил не того человека').toBe(fx.userId);
    expect(login.body.company.id, 'PIN впустил в чужую компанию').toBe(fx.companyId);
  });

  it('и правка чужого PIN-а на занятый цифрами тоже отклоняется', async () => {
    const theirs = await createFixture();
    await prisma.user.update({ where: { id: fx.userId }, data: { posPin: '515151' } });
    const someone = await api(theirs.token, 'POST', '/pos/users', {
      name: 'Второй',
      role: 'cashier',
      posPin: '626262',
    });
    expect(someone.status, JSON.stringify(someone.body)).toBe(201);

    const clash = await api(theirs.token, 'PATCH', `/pos/users/${someone.body.id}`, {
      name: 'Второй',
      role: 'cashier',
      posPin: '515151',
    });
    expect(clash.status).toBe(409);
  });
});
