import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Сервер узнаёт язык человека, потому что однажды ему придётся заговорить.
 *
 * Внутри кассы перевод живёт в самой кассе: сервер отвечает по-русски, а экран
 * говорит по-казахски. Приём хороший и до 16.09.2026 хватал на всё — кроме
 * одного места. Утреннюю сводку рисует операционная система телефона, словарь
 * кассы до неё не дотягивается даже в принципе, и владелец, у которого вся
 * касса по-казахски, получал единственное сообщение системы по-русски.
 *
 * Отдельного экрана «на каком языке вам писать» нет намеренно: человек уже
 * выбрал язык, и выбрал на том самом экране, где вводит PIN. Переспрашивать —
 * значит требовать ответа на отвеченный вопрос. Поэтому язык записывается сам,
 * в двух местах: на входе и при переключении.
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

async function languageOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.language;
}

describe('язык человека', () => {
  it('записывается на входе', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    const login = await api(null, 'POST', '/pos/login', { pin: user.posPin, language: 'kk' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    expect(await languageOf(fx.userId)).toBe('kk');
  });

  it('и меняется, когда его переключили уже войдя', async () => {
    // Самый частый случай: зашёл, огляделся, переключил. Без этого выбор
    // доехал бы до сервера со следующим входом, а тот бывает раз в месяц — и
    // сводка всё это время приходила бы на чужом языке при правильном экране.
    const put = await api(fx.token, 'PUT', '/pos/me/language', { language: 'kk' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(await languageOf(fx.userId)).toBe('kk');

    const back = await api(fx.token, 'PUT', '/pos/me/language', { language: 'ru' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(await languageOf(fx.userId)).toBe('ru');
  });

  it('а незнакомое значение не записывается ни при входе, ни потом', async () => {
    // Язык — строка в теле запроса, и когда-нибудь туда попадёт что-то третье.
    // Записать его значило бы получить владельца, которому сводка не приходит
    // ни на одном языке, — и искать причину пришлось бы в рассылке.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    const login = await api(null, 'POST', '/pos/login', { pin: user.posPin, language: 'эльфийский' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(await languageOf(fx.userId)).toBeNull();

    const put = await api(fx.token, 'PUT', '/pos/me/language', { language: 'эльфийский' });
    expect(put.status).toBe(400);
    expect(await languageOf(fx.userId)).toBeNull();
  });

  it('и вход без языка вовсе ничего не портит', async () => {
    // Касса старой сборки языка не присылает. Затереть им уже сделанный выбор
    // значило бы, что один планшет в углу отменяет настройку владельца.
    await api(fx.token, 'PUT', '/pos/me/language', { language: 'kk' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });

    const login = await api(null, 'POST', '/pos/login', { pin: user.posPin });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(await languageOf(fx.userId)).toBe('kk');
  });

  it('и чужой язык этим не поменять — только свой', async () => {
    // Маршрут называется `me` и отвечает за одного человека: того, чей токен
    // предъявлен. Иначе кассир, переключивший себе казахский, переключил бы
    // его владельцу.
    const cashier = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Кассир', role: 'cashier', posPin: '8811' },
    });
    const login = await api(null, 'POST', '/pos/login', { pin: '8811' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const put = await api(login.body.token, 'PUT', '/pos/me/language', { language: 'kk' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    expect(await languageOf(cashier.id)).toBe('kk');
    expect(await languageOf(fx.userId)).toBeNull();
  });
});
