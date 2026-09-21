import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Набранное чистится только после ответа сервера.
 *
 * Дважды в одном обходе экран выбрасывал работу человека, не дожидаясь ответа:
 * стол в кафе — шесть позиций и отсканированные из рук гостя пачки, план зала
 * — форму нового стола, которая при отказе ещё и закрывалась, так что владелец
 * видел ошибку вместо формы, которой больше нет.
 *
 * Остальные два десятка экранов написаны правильно, и правило у них одно:
 * дождаться, спросить результат, и только потом чистить. Нигде оно не было
 * записано — поэтому и повторилось.
 *
 * Проверяются два признака, и оба однозначные: вызов наружу должен быть
 * дождан, а очистка — стоять за развилкой. «За развилкой» считается по
 * скобкам: либо она вложена в блок, открывшийся после ответа, либо между
 * ответом и ею есть ранний выход. Так выглядят обе законные записи:
 *
 *     const ok = await onSubmit(...);  |  if (!(await onCreate(...))) return;
 *     if (ok) { setLines([]); }        |  setName('');
 *
 * Считать по скобкам, а не по именам переменных, — намеренно: имена меняются,
 * вложенность нет.
 *
 * Чего проверка не видит: условие с заведомо истинным выражением — `if (true)`
 * — она признаёт развилкой. Это сказано прямо, а не умолчано: ловятся здесь
 * две ошибки, которые действительно делают, — не дождаться ответа и почистить
 * безусловно. Писать `if (true)` никто не станет, а проверять осмысленность
 * условия значило бы разбирать выражение и врать о том, что мы её знаем.
 */

const DIR = resolve(__dirname, 'components');

/** Очистка набранного: пустой список, пустая строка, пустой объект. */
const CLEAR = /set[A-Z][A-Za-z]*\((\[\]|''|\{\})\)/;
const CALLS_PROP = /\bon[A-Z][A-Za-z]*\(/;

/**
 * Убираем комментарии: разбор не должен читать слова из объяснения.
 *
 * Не выдумано: охрана вёрстки однажды прочла `min-width: 0` из комментария,
 * который сама же и объясняла, и молча прошла.
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Тело функции: сначала закрываем список параметров, потом берём блок. */
export function bodyAfterParams(source: string, at: number): string {
  const paren = source.indexOf('(', at);
  if (paren < 0) return '';
  let depth = 0;
  let i = paren;
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const open = source.indexOf('{', i);
  if (open < 0) return '';
  let braces = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === '{') braces += 1;
    else if (source[j] === '}') {
      braces -= 1;
      if (braces === 0) return source.slice(open, j + 1);
    }
  }
  return '';
}

/** Глубина вложенности в точке: 1 — верхний уровень тела функции. */
function depthAt(body: string, index: number): number {
  let depth = 0;
  for (let i = 0; i <= index && i < body.length; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') depth -= 1;
  }
  return depth;
}

export function submitHandlers(source: string): { name: string; waits: boolean }[] {
  const out: { name: string; waits: boolean }[] = [];
  const clean = withoutComments(source);
  for (const match of clean.matchAll(/(?:async )?function ((?:handle|submit|save|send)[A-Za-z]*)\s*\(/g)) {
    const body = bodyAfterParams(clean, match.index!);
    if (!body) continue;
    const call = CALLS_PROP.exec(body);
    const clear = CLEAR.exec(body);
    // Интересны только те, кто зовёт наружу и потом чистит своё.
    if (!call || !clear || clear.index! < call.index!) continue;

    // Очистка в ветке `catch` — это очистка при ошибке, и часто верная:
    // неверный PIN обязан стереться, иначе кассир дотыкивает цифры к чужой
    // ошибке. Нас занимает только путь успеха.
    const catchAt = body.lastIndexOf('catch', clear.index!);
    if (catchAt >= 0 && depthAt(body, clear.index!) > depthAt(body, catchAt)) continue;

    const before = body.slice(0, clear.index!);
    const awaited = before.search(/await\s+on[A-Z]/);
    if (awaited < 0) {
      out.push({ name: match[1], waits: false });
      continue;
    }
    const nested = depthAt(body, clear.index!) > depthAt(body, awaited);
    const exits = /\breturn\b/.test(before.slice(awaited));
    /* Третья законная запись: развилка без фигурных скобок — `if (done)
       setCounted({});`. Вложенности нет, выхода нет, а условие есть, и стоит
       оно в том же операторе, что и очистка. */
    const stmtStart = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1;
    const inlineIf = /\bif\s*\(/.test(before.slice(stmtStart));
    out.push({ name: match[1], waits: nested || exits || inlineIf });
  }
  return out;
}

describe('очистка набранного ждёт ответа', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));

  it('экраны вообще разобрались', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    const всего = files.reduce(
      (sum, f) => sum + submitHandlers(readFileSync(resolve(DIR, f), 'utf8').replace(/\r\n/g, '\n')).length,
      0,
    );
    expect(всего, 'не нашлись обработчики — разошёлся разбор, а не код').toBeGreaterThan(10);
  });

  it('и ни один не выбрасывает работу до ответа', () => {
    const забывшие: string[] = [];
    for (const file of files) {
      const source = readFileSync(resolve(DIR, file), 'utf8').replace(/\r\n/g, '\n');
      for (const handler of submitHandlers(source)) {
        if (!handler.waits) забывшие.push(`${file}: ${handler.name}`);
      }
    }
    expect(забывшие, 'отказ сервера — и набранного человеком больше нет').toEqual([]);
  });

  it('а разбор узнаёт обе законные записи и обе ошибки', () => {
    const неждёт = `
      function handleCreate(a: { x: number }) {
        onCreateTable(name, seats);
        setName('');
      }
    `;
    expect(submitHandlers(неждёт)).toEqual([{ name: 'handleCreate', waits: false }]);

    const неспрашивает = `
      async function handleSend(a: { x: number }) {
        await onSend(items);
        setDraft([]);
      }
    `;
    expect(submitHandlers(неспрашивает)).toEqual([{ name: 'handleSend', waits: false }]);

    const развилкаПосле = `
      async function handleSubmit(a: { x: number }) {
        const success = await onSubmit(lines);
        if (success) {
          setLines([]);
        }
      }
    `;
    expect(submitHandlers(развилкаПосле)).toEqual([{ name: 'handleSubmit', waits: true }]);

    const развилкаДо = `
      async function handleCreate(a: { x: number }) {
        if (!(await onCreateTable(name, seats))) return;
        setName('');
      }
    `;
    expect(submitHandlers(развилкаДо)).toEqual([{ name: 'handleCreate', waits: true }]);

    const развилкаБезСкобок = `
      async function submit(a: { x: number }) {
        const done = await onSubmit(bin, lines);
        if (done) setCounted({});
      }
    `;
    expect(submitHandlers(развилкаБезСкобок)).toEqual([{ name: 'submit', waits: true }]);

    const чиститПриОшибке = `
      async function submit(a: { x: number }) {
        try {
          const s = await onLogin(value);
          use(s);
        } catch (err) {
          setPin('');
        }
      }
    `;
    expect(submitHandlers(чиститПриОшибке)).toEqual([]);
  });
});
