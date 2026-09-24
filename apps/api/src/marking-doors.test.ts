import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Каждый путь, уводящий товар с полки, обязан сказать, что он делает с кодами.
 *
 * Дверей больше, чем кажется. Обычный чек — очевидная; заказ за столом в кафе
 * оказался второй, и через него бар отпускал сигареты мимо всей маркировки:
 * товар списывался, остаток сходился, а кода никто не спрашивал. Нашлось это
 * не тестом и не экраном, а тем, что кто-то сел и перечислил все списания
 * подряд.
 *
 * Здесь этот список перечисляется сам. Появится новый путь — или у старого
 * появится новая причина списания — и тест упадёт, пока автор не напишет
 * словами, что при этом происходит с кодами. Ответ «ничего» тоже принимается:
 * у сырья в производстве кодов не бывает. Не принимается молчание.
 */

const routes = withoutComments(readFileSync(resolve(__dirname, 'routes', 'pos.ts'), 'utf8')).replace(/\r\n/g, '\n');

/**
 * Аргументы вызова целиком — со счётом скобок.
 *
 * Обрывать по первой закрывающей нельзя: у этих вызовов внутри аргументов
 * стоят свои скобки (`stockByProduct.get(id) ?? []`), и разбор «до первой
 * скобки» находил две двери из восьми — то есть молча пропускал шесть.
 */
function callArguments(source: string, name: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${name}(`, from);
    if (at < 0) break;
    const open = at + name.length;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    calls.push(source.slice(open + 1, end));
    from = end;
  }
  return calls;
}

/** Причины, с которыми товар снимается с остатка. */
export function deductionReasons(source: string): string[] {
  const found = new Set<string>();
  for (const args of callArguments(source, 'deductAcrossBins')) {
    const reason = /'([a-z_]+)'/.exec(args);
    if (reason) found.add(reason[1]);
  }
  for (const args of callArguments(source, 'applyStockDelta')) {
    // Снятие, а не пополнение: у пополнения знака минус перед количеством нет.
    if (!/,\s*-/.test(args)) continue;
    const reason = /'([a-z_]+)'/.exec(args);
    if (reason) found.add(reason[1]);
  }
  return [...found].sort();
}

/**
 * Что происходит с кодами маркировки на каждом пути.
 *
 * Строка — не украшение: её читает следующий автор, когда добавляет свой путь
 * и видит упавший тест.
 */
const ЧТО_С_КОДАМИ: Record<string, string> = {
  sale: 'гасит коды и не пропускает маркированный товар без них — `resolveSaleCodes`',
  table_order: 'то же правило, вторая дверь продажи — тот же `resolveSaleCodes`',
  transfer_out: 'переводит коды в «в пути»; приёмка ставит их на получателя, отмена возвращает',
  write_off: 'переводит коды в «списан»: упаковки в магазине больше нет',
  supplier_return:
    'переводит коды в «вернули поставщику» и запоминает документ: пачка уехала обратно, ' +
    'и списанием это называть неверно — за неё вернули деньги',
  order_fulfill:
    'гасит коды как продажу: выдача заказа — это и есть передача товара покупателю, просто не через кассу. ' +
    'Одним нажатием проходит только случай без вопросов; частичную выдачу сканируют на сборке',
  adjustment:
    'ничего, и это решение. Недостача по пересчёту — это «пачек нет, а каких именно, никто не знает»; ' +
    'гасить наугад значит объявить проданной пачку, которая лежит на полке. Расхождение видно в самом пересчёте',
  production_out: 'ничего: в производство уходит сырьё, а сырьё не маркируют поштучно',
};

describe('двери, через которые уходит товар', () => {
  it('все перечислены, и про каждую сказано, что она делает с кодами', () => {
    const reasons = deductionReasons(routes);

    // Страховка на разбор: переименуют помощника — и тест начнёт проходить,
    // ничего не проверяя.
    expect(reasons.length, 'не нашлись списания — разошёлся разбор, а не код').toBeGreaterThan(5);

    const безответа = reasons.filter((reason) => !(reason in ЧТО_С_КОДАМИ));
    expect(безответа, 'новый путь списания: напишите, что при нём происходит с кодами').toEqual([]);
  });

  it('и в списке нет путей, которых больше нет', () => {
    // Иначе список переживает код и начинает описывать несуществующее.
    const reasons = new Set(deductionReasons(routes));
    const лишние = Object.keys(ЧТО_С_КОДАМИ).filter((reason) => !reasons.has(reason));
    expect(лишние, 'путь описан, а списания с такой причиной в коде нет').toEqual([]);
  });

  it('а сам разбор отличает списание от пополнения', () => {
    // Иначе первое, что он докажет, — что находит любую строку подряд.
    // `return` здесь — пополнение: возврат кладёт товар обратно, и спрашивать
    // с него про гашение кодов не за что.
    const образец = `
      await deductAcrossBins(tx, rows, line.quantity, 'write_off', { documentId: id });
      await applyStockDelta(tx, stock, -needed, 'made_up', {});
      await applyStockDelta(tx, stock, line.quantity, 'return', {});
    `;
    expect(deductionReasons(образец)).toEqual(['made_up', 'write_off']);
  });
});
