import { describe, expect, it } from 'vitest';
import {
  CHECK_EVERY_MS,
  REMIND_EVERY_MS,
  SILENCE_BEFORE_NOTICE_MS,
  dueForCheck,
  dueForReminder,
  outOfTouch,
} from './licence';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-15T12:00:00Z');

describe('часы лицензии', () => {
  it('совпадают с тем, что обещано владельцу', () => {
    // Числа записаны в docs/DECISIONS.md как его решение, а не как настройка.
    // Проверяются здесь, чтобы «раз в час» не превратилось однажды в «раз в
    // пять минут» походя, ради удобства отладки.
    expect(CHECK_EVERY_MS).toBe(HOUR);
    expect(SILENCE_BEFORE_NOTICE_MS).toBe(HOUR);
    expect(REMIND_EVERY_MS).toBe(4 * HOUR);
  });
});

describe('когда спрашивать сервер', () => {
  it('сразу, если ещё не спрашивали', () => {
    expect(dueForCheck(NOW, null)).toBe(true);
  });

  it('через час после прошлого раза', () => {
    expect(dueForCheck(NOW, NOW - HOUR + 1000)).toBe(false);
    expect(dueForCheck(NOW, NOW - HOUR)).toBe(true);
  });

  it('и не ждёт молча, если часы на планшете перевели назад', () => {
    // «Последний раз» оказался в будущем. Разница отрицательная, и правило
    // «прошёл ли час» не наступит никогда: касса замолчала бы навсегда.
    expect(dueForCheck(NOW, NOW + 5 * HOUR)).toBe(true);
  });
});

describe('«подключите интернет»', () => {
  it('молчит, пока связь свежая', () => {
    expect(outOfTouch(NOW, NOW - 10 * 60 * 1000)).toBe(false);
  });

  it('говорит после часа без подтверждения', () => {
    expect(outOfTouch(NOW, NOW - HOUR)).toBe(true);
  });

  it('и говорит сразу, если подтверждения не было вовсе', () => {
    // Касса поднялась из хранилища без сети: она не знает про магазин ничего
    // свежего, и делать вид, что знает, нельзя.
    expect(outOfTouch(NOW, null)).toBe(true);
  });

  it('но не по переведённым часам', () => {
    // Здесь молчим, в отличие от `dueForCheck`. Разница намеренная: лишний
    // запрос стоит ничего, а ложное «подключите интернет» на работающей кассе
    // — это то, из-за чего перестают верить сообщениям.
    expect(outOfTouch(NOW, NOW + 5 * HOUR)).toBe(false);
  });
});

describe('напоминание в последние сутки', () => {
  it('в последний день — сразу, а потом раз в четыре часа', () => {
    expect(dueForReminder(0, NOW, null)).toBe(true);
    expect(dueForReminder(0, NOW, NOW - 3 * HOUR)).toBe(false);
    expect(dueForReminder(0, NOW, NOW - 4 * HOUR)).toBe(true);
  });

  it('за день до конца — тоже', () => {
    expect(dueForReminder(1, NOW, null)).toBe(true);
  });

  it('а за неделю — нет', () => {
    // Полоска за неделю уже сказана на открытии смены. Окно каждые четыре часа
    // всю неделю научит закрывать это окно не читая — и в последние сутки оно
    // уже ничего не даст.
    expect(dueForReminder(7, NOW, null)).toBe(false);
    expect(dueForReminder(2, NOW, null)).toBe(false);
  });

  it('и после конца — тоже нет', () => {
    // Напоминать не о чем: касса к этому моменту уже не пишет, и скажет ей об
    // этом сервер отказом, а не таймер напоминанием.
    expect(dueForReminder(-1, NOW, null)).toBe(false);
  });

  it('и закрывается кнопкой, даже когда «напомнили» чуть в будущем', () => {
    // «Сейчас» в кассе пересчитывается раз в минуту, а «напомнили» ставится в
    // момент нажатия — то есть почти всегда оказывается позже него. Пока это
    // читалось как «часы перевели назад, напоминай», кнопка «понятно» не
    // закрывала ничего.
    expect(dueForReminder(0, NOW, NOW + 1000)).toBe(false);
    expect(dueForReminder(0, NOW, NOW + 5 * HOUR)).toBe(false);
  });

  it('молчит, пока сервер про тариф ничего не сказал', () => {
    // Сессия, сохранённая прошлой сборкой, про тариф не знает. Это не повод
    // будить человека окном.
    expect(dueForReminder(null, NOW, null)).toBe(false);
    expect(dueForReminder(undefined, NOW, null)).toBe(false);
  });
});
