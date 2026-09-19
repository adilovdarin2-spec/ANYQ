import { markedCodeKey, parseMarkedCode } from './marking';

/**
 * Какие именно коды уходят вместе с товаром.
 *
 * Один и тот же вопрос задают три операции: возврат, перемещение на другую
 * точку и списание. Товар двигают — коды обязаны двинуться следом, иначе
 * остаток и коды начинают жить порознь, и первым это замечает покупатель, чью
 * пачку касса отказывается пробить.
 *
 * Дальше — про возврат, с которого всё началось.
 *
 *
 * Без этого возврат тихо портит две вещи сразу. Пачка ложится обратно на полку
 * — остаток растёт, — а её код остаётся «продан» навсегда, и продать эту пачку
 * второй раз уже нельзя: касса потребует код, сервер ответит «уже продан».
 * Товар есть, по бумагам он есть, продать его невозможно, и понять почему
 * можно только заглянув в базу.
 *
 * Какой именно код вернулся — не всегда очевидно, и угадывать нельзя. Если из
 * трёх проданных пачек несут одну, а кассир её не отсканировал, то погасив
 * «любую из трёх» мы запишем на полку пачку A, тогда как принесли B. Продать
 * B потом будет нельзя — та же беда, только отложенная и уже необъяснимая.
 *
 * Поэтому: сканируют — верим скану; несут всё, что осталось по этому чеку, —
 * вопроса нет; несут часть без скана — отказываем и говорим, что сделать.
 */

export interface SoldCode {
  id: string;
  gtin: string;
  serial: string;
}

/**
 * Те же отказы, но словами выдачи заказа.
 *
 * Выдача — это передача товара покупателю, просто не через кассу: у клиента
 * заказ, у кладовщика коробка, и вопрос тот же — какие пачки в неё кладут.
 */
export function orderCodesRefusalMessage(refusal: ReturnCodesRefusal): string {
  switch (refusal.kind) {
    case 'needScan':
      return 'Отсканируйте коды выдаваемых упаковок — соберите заказ, чтобы это сделать';
    case 'unreadable':
      return 'Код не читается — поднесите сканер к квадратному коду на упаковке ещё раз';
    case 'notInSale':
      return 'Этой упаковки нет в остатке этой точки — проверьте, ту ли взяли';
    case 'duplicate':
      return 'Один и тот же код поднесён дважды — каждая упаковка сканируется один раз';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а упаковок ${refusal.quantity} — их должно быть поровну`;
  }
}

export type ReturnCodesRefusal =
  /** Часть пачек без скана: какая именно вернулась — неизвестно. */
  | { kind: 'needScan'; returning: number; outstanding: number }
  | { kind: 'unreadable'; raw: string }
  /** Код читается, но этот чек его не продавал. */
  | { kind: 'notInSale'; key: string }
  | { kind: 'duplicate'; key: string }
  | { kind: 'countMismatch'; codes: number; quantity: number };

export type ReturnCodesPlan =
  | { ok: true; codeIds: string[] }
  | { ok: false; refusal: ReturnCodesRefusal };

export function returnCodesRefusalMessage(refusal: ReturnCodesRefusal): string {
  switch (refusal.kind) {
    case 'needScan':
      return 'Отсканируйте код возвращаемой упаковки — иначе неизвестно, какая именно вернулась';
    case 'unreadable':
      return 'Код не читается — поднесите сканер к квадратному коду на упаковке ещё раз';
    case 'notInSale':
      return 'Этот код продан не по этому чеку — найдите чек, по которому упаковку купили';
    case 'duplicate':
      return 'Один и тот же код поднесён дважды — каждая упаковка сканируется один раз';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а упаковок ${refusal.quantity} — их должно быть поровну`;
  }
}

/**
 * Какие коды погасить обратно при возврате одного товара.
 *
 * @param outstanding коды этой продажи по этому товару, ещё не возвращённые.
 * Пусто — товар немаркированный, и возвращать нечего.
 * @param scanned то, что поднесли сканером; пусто или не задано — не сканировали.
 */
export function pickCodes(input: {
  quantity: number;
  outstanding: SoldCode[];
  scanned?: string[];
}): ReturnCodesPlan {
  const { quantity, outstanding } = input;
  const scanned = input.scanned ?? [];

  // Товар без кодов — обычный возврат, каким он был всегда.
  if (outstanding.length === 0 && scanned.length === 0) return { ok: true, codeIds: [] };

  if (scanned.length > 0) {
    if (scanned.length !== quantity) {
      return { ok: false, refusal: { kind: 'countMismatch', codes: scanned.length, quantity } };
    }
    const byKey = new Map(outstanding.map((c) => [markedCodeKey(c), c]));
    const seen = new Set<string>();
    const codeIds: string[] = [];
    for (const raw of scanned) {
      const parsed = parseMarkedCode(raw);
      if (!parsed.ok) return { ok: false, refusal: { kind: 'unreadable', raw: String(raw) } };
      const key = markedCodeKey(parsed.code);
      if (seen.has(key)) return { ok: false, refusal: { kind: 'duplicate', key } };
      const match = byKey.get(key);
      if (!match) return { ok: false, refusal: { kind: 'notInSale', key } };
      seen.add(key);
      codeIds.push(match.id);
    }
    return { ok: true, codeIds };
  }

  // Не сканировали. Вопроса нет ровно в одном случае: возвращают всё, что по
  // этому чеку ещё не вернули, — тогда какие коды, известно без скана.
  if (quantity === outstanding.length) {
    return { ok: true, codeIds: outstanding.map((c) => c.id) };
  }

  return { ok: false, refusal: { kind: 'needScan', returning: quantity, outstanding: outstanding.length } };
}

/**
 * Те же отказы, но словами перемещения.
 *
 * Отдельно от возврата, потому что человек другой и делает он другое. «Найдите
 * чек, по которому купили» кладовщику, собирающему фургон, не говорит ничего:
 * у него нет чека, у него есть накладная и полка.
 */
export function transferCodesRefusalMessage(refusal: ReturnCodesRefusal): string {
  switch (refusal.kind) {
    case 'needScan':
      return 'Отсканируйте коды отправляемых упаковок — иначе неизвестно, какие именно уехали';
    case 'unreadable':
      return 'Код не читается — поднесите сканер к квадратному коду на упаковке ещё раз';
    case 'notInSale':
      return 'Этой упаковки нет на отправляющей точке — проверьте, ту ли коробку взяли';
    case 'duplicate':
      return 'Один и тот же код поднесён дважды — каждая упаковка сканируется один раз';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а упаковок ${refusal.quantity} — их должно быть поровну`;
  }
}

/**
 * Те же отказы, но словами списания.
 *
 * Списывает обычно владелец или старший смены, и разговор у него не с
 * покупателем, а с полкой: что именно разбилось, просрочилось, не доехало.
 */
export function writeOffCodesRefusalMessage(refusal: ReturnCodesRefusal): string {
  switch (refusal.kind) {
    case 'needScan':
      return 'Отсканируйте коды списываемых упаковок — иначе списанной окажется не та';
    case 'unreadable':
      return 'Код не читается — поднесите сканер к квадратному коду на упаковке ещё раз';
    case 'notInSale':
      return 'Этой упаковки нет в остатке этой точки — проверьте, ту ли взяли';
    case 'duplicate':
      return 'Один и тот же код поднесён дважды — каждая упаковка сканируется один раз';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а упаковок ${refusal.quantity} — их должно быть поровну`;
  }
}

/**
 * Те же отказы, но словами возврата поставщику.
 *
 * Здесь собирают коробку обратно в машину поставщика, и вопрос у человека
 * ровно один: какие пачки в неё кладут.
 */
export function supplierReturnCodesRefusalMessage(refusal: ReturnCodesRefusal): string {
  switch (refusal.kind) {
    case 'needScan':
      return 'Отсканируйте коды возвращаемых поставщику упаковок — иначе уедет не та';
    case 'unreadable':
      return 'Код не читается — поднесите сканер к квадратному коду на упаковке ещё раз';
    case 'notInSale':
      return 'Этой упаковки нет в остатке этой точки — проверьте, ту ли взяли';
    case 'duplicate':
      return 'Один и тот же код поднесён дважды — каждая упаковка сканируется один раз';
    case 'countMismatch':
      return `Кодов ${refusal.codes}, а упаковок ${refusal.quantity} — их должно быть поровну`;
  }
}

/**
 * То же решение, но сразу по всем строкам документа.
 *
 * Один и тот же цикл — «сгруппировать по товару, спросить `pickCodes`, собрать
 * идентификаторы» — писался в каждом маршруте заново: возврат, перемещение,
 * списание, возврат поставщику, выдача заказа. Пятая копия и была поводом
 * вынести его сюда: расходятся такие копии молча и по одной.
 */
export function planDocumentCodes(input: {
  /** Коды этой точки, доступные к выбытию, по всем товарам документа. */
  outstanding: (SoldCode & { productId: string })[];
  /** Строки документа: что и сколько уходит, и что при этом отсканировали. */
  lines: { productId: string; quantity: number; codes?: string[] }[];
}): { ok: true; codeIds: string[] } | { ok: false; refusal: ReturnCodesRefusal } {
  if (input.outstanding.length === 0) return { ok: true, codeIds: [] };

  const byProduct = new Map<string, { quantity: number; scanned: string[] }>();
  for (const line of input.lines) {
    const entry = byProduct.get(line.productId) ?? { quantity: 0, scanned: [] };
    entry.quantity += line.quantity;
    if (line.codes) entry.scanned.push(...line.codes);
    byProduct.set(line.productId, entry);
  }

  const codeIds: string[] = [];
  for (const [productId, entry] of byProduct) {
    const plan = pickCodes({
      quantity: entry.quantity,
      outstanding: input.outstanding.filter((c) => c.productId === productId),
      scanned: entry.scanned,
    });
    if (!plan.ok) return plan;
    codeIds.push(...plan.codeIds);
  }
  return { ok: true, codeIds };
}
