import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';
import { codesNeeded } from './marking-scan';

/**
 * Маркированный товар вообще можно завести в магазин.
 *
 * Сервер требует код на каждую упаковку — «принимается только по коду
 * маркировки», — и требует правильно: пачка без кода по документам останется на
 * полке навсегда. А на экране приёмки подносить код было негде. «Оприходовать»
 * отклонялось целиком, и исправить это на экране было нечем.
 *
 * Вторая дверь, «Партии», коды принимает, но просит номер партии и срок
 * годности — их нет ни у пачки сигарет, ни у бутылки пива. То есть до
 * 30.09.2026 сигареты, пиво и обувь не заводились в магазин никак. Для
 * продуктового в Казахстане это половина выручки.
 *
 * Найдено 30.09.2026 прогоном приёмки руками: накладная из двух строк, «Хлеб
 * «Бородинский»» помечен маркированным, и приёмка вернула отказ, на который
 * нечем ответить.
 */

const SCREEN = withoutComments(readFileSync(resolve(__dirname, 'components', 'IncomingScreen.tsx'), 'utf8'));

describe('сколько кодов нужно строке приёмки', () => {
  it('немаркированному — ни одного', () => {
    expect(codesNeeded(24, 1, false)).toBe(0);
    expect(codesNeeded(2, 12, false)).toBe(0);
  });

  it('маркированному поштучно — по одному на штуку', () => {
    expect(codesNeeded(3, 1, true)).toBe(3);
  });

  it('а ящиком — по одному на пачку внутри ящика, а не на ящик', () => {
    /* То, на чём защита ломалась молча: один код на блок из десяти проходил, и
       девять пачек входили в магазин непродаваемыми. */
    expect(codesNeeded(1, 10, true)).toBe(10);
    expect(codesNeeded(2, 10, true)).toBe(20);
  });

  it('и столько же, на сколько встанет остаток, при любом ящике', () => {
    // Свойством: кодов ровно столько, на сколько поднимется остаток.
    for (const ящиков of [1, 2, 7]) {
      for (const вящике of [1, 3, 10, 24]) {
        expect(codesNeeded(ящиков, вящике, true), `${ящиков} × ${вящике}`).toBe(ящиков * вящике);
      }
    }
  });

  it('пустое количество кодов не требует', () => {
    // Иначе поле скана открывалось бы до того, как сказано, сколько товара.
    expect(codesNeeded(0, 10, true)).toBe(0);
    expect(codesNeeded(Number.NaN, 10, true)).toBe(0);
  });
});

describe('экран приёмки', () => {
  it('исходник разобрался', () => {
    // Иначе всё ниже пройдёт на пустой строке.
    expect(SCREEN).toContain('transfer-add-row');
    expect(SCREEN).toContain('function addLine');
  });

  it('даёт поднести код', () => {
    expect(SCREEN, 'подносить код на приёмке снова негде').toContain('scanIncomingCode');
    expect(SCREEN).toContain("t('batch.scanPlaceholder')");
    expect(SCREEN).toContain('incoming-scan');
  });

  it('и показывает поле только маркированному товару и только с количеством', () => {
    /* Поле, открытое всегда, кладовщик будет закрывать на каждой строке воды —
       и перестанет читать всё, что на экране написано. */
    expect(SCREEN).toContain('{needCodes > 0 && (');
    expect(SCREEN).toContain('codesNeeded(');
  });

  it('и считает нужные коды по упаковкам, а не по накладной', () => {
    // Тот же счёт, что у сервера: иначе экран и сервер разойдутся в отказе.
    const at = SCREEN.indexOf('const needCodes = codesNeeded(');
    expect(at, 'needCodes считается как-то иначе').toBeGreaterThan(-1);
    const call = SCREEN.slice(at, SCREEN.indexOf(';', at));
    expect(call, 'коды снова считаются по количеству в накладной').toContain('unitsPerPack');
  });

  it('и не кладёт в накладную строку, которой не хватает кодов', () => {
    const at = SCREEN.indexOf('function addLine');
    const body = SCREEN.slice(at, SCREEN.indexOf('\n  }', at));
    expect(body.length, 'тело addLine вырезано пустым').toBeGreaterThan(200);
    expect(body, 'кодов в addLine не проверяют вовсе').toContain('codes.length !== need');
    // И отказывает словами: молчащая кнопка «Добавить» не отличима от сломанной.
    expect(body, 'отказ молчит').toContain("setCodeError(t('incoming.needCodes'");
  });

  it('и коды уходят на сервер вместе со строкой', () => {
    /* Набрать коды и не отправить их — это ровно тот отказ, ради которого всё
       это писалось, только с лишней работой сканером. */
    expect(SCREEN).toContain('codes: l.codes');
  });

  it('и накладная файлом тоже даёт поднести код', () => {
    /* Вторая дверь той же приёмки, и дыра в ней была та же: сервер отказывал
       всей накладной целиком — вместе с водой, к маркировке отношения не
       имеющей, — а поднести код было негде. Магазин, которому поставщик
       присылает файл с пивом и сигаретами, не мог принять этот файл вовсе. */
    const note = withoutComments(readFileSync(resolve(__dirname, 'components', 'DeliveryNoteScreen.tsx'), 'utf8'));
    expect(note, 'в накладной файлом снова негде поднести код').toContain('scanCode(');
    expect(note).toContain("t('batch.scanPlaceholder')");
    expect(note, 'коды не уезжают вместе со строкой').toContain('codes: codes[line.productId!]');
    // И накладную с непросканированной строкой отправлять некуда.
    expect(note).toContain('unscanned.length > 0 || submitting');
    expect(note, 'кнопка гаснет молча').toContain("t('incoming.needCodes'");
  });

  it('а маркированное из заказа не подставляется молча', () => {
    /* Подставленная строка без кодов ушла бы на сервер и вернулась отказом, а
       дописать к ней коды нечем — они набираются до того, как строка легла в
       накладную. Поэтому такие позиции названы по именам. */
    expect(SCREEN).toContain('markedFromOrder');
    expect(SCREEN).toContain("t('incoming.markedByScanner'");
  });
});
