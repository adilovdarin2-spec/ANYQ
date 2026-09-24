import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Кассу можно передать, не открывая смену.
 *
 * Выйти из кассы можно было ровно в одном месте — в профиле. А профиль виден
 * только при открытой смене: пока смены нет, всё приложение — это экран её
 * открытия, без вкладок.
 *
 * Отсюда тупик. Утренний кассир закрывает смену, и касса остаётся на нём:
 * вечерний не может начать свою, не зная его PIN. Единственный оставшийся путь
 * — передать кассу под открытой сменой, то есть ровно то, чего делать нельзя:
 * сервер приписывает всё пришедшее тому, кто вошёл, и продажи с ящиком
 * достались бы не тому человеку.
 *
 * На практике это кончалось бы тем, что касса весь день стоит под одним
 * кассиром, а его именем записаны чужие смены и чужие чеки.
 *
 * Проверяется, что дверь есть там, где она нужна, — на экране открытия смены, в
 * ту самую минуту, когда касса переходит из рук в руки.
 */

const SCREEN = resolve(__dirname, 'components', 'OpenShiftScreen.tsx');
const APP = resolve(__dirname, 'App.tsx');
const PROFILE = resolve(__dirname, 'components', 'ProfileScreen.tsx');

const read = (path: string) => withoutComments(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));

describe('передача кассы другому кассиру', () => {
  const screen = read(SCREEN);
  const app = read(APP);

  it('файлы вообще разобрались', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(screen).toContain('export function OpenShiftScreen');
    expect(app).toContain('<OpenShiftScreen');
  });

  it('на экране открытия смены есть выход', () => {
    expect(screen).toContain('onSwitchCashier');
    expect(screen).toContain("onClick={onSwitchCashier}");
  });

  it('и приложение его действительно подключает', () => {
    /* Без этого проп остаётся объявленным и не вызванным: экран выглядит
       рабочим, кнопка ничего не делает, тупик на месте. */
    expect(app).toContain('onSwitchCashier={handleLogout}');
    expect(app).toContain('cashierName={session.user.name}');
  });

  it('и говорит, кого меняют', () => {
    // Сменяющий должен видеть, под кем стоит касса, прежде чем её забрать.
    expect(screen).toContain("t('shift.open.whoIsHere'");
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      const фраза = (d as Record<string, string>)['shift.open.whoIsHere'];
      expect(фраза, `${язык}: нет фразы`).toBeTruthy();
      expect(фраза, `${язык}: имя не подставляется`).toContain('{name}');
    }
  });

  it('а вторая дверь — в профиле — никуда не делась', () => {
    /* Обратная сторона: убрать её оттуда значило бы поменять один тупик на
       другой. Она остаётся, и про её опасность сказано отдельно — сервер
       приписывает офлайновую работу тому, кто вошёл, и это чинится протоколом,
       а не кнопкой. */
    expect(read(PROFILE)).toContain('onLogout');
    expect(app).toContain('onLogout={handleLogout}');
  });
});
