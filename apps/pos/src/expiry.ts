import type { Batch } from './types';

/**
 * Какой срок годности достанется покупателю — на плитке товара.
 *
 * Аптека держится на сроках, а плитка товара у фармацевта была ровно та же,
 * что у продавца хлеба: название, цена, остаток. Человек, отпускающий
 * парацетамол, не видел, что ближайшая пачка кончается через неделю, — а
 * узнать это ему негде: партии лежат на отдельном экране, и открывать его на
 * каждую продажу никто не станет.
 *
 * Показывается не всё подряд. Дата на каждой плитке — это шум, который
 * перестают читать через день, и вместе с ним перестают читать ту одну, ради
 * которой всё затевалось. Поэтому только когда срок близок: сервер уже
 * решил это за нас и прислал `expiring_soon`.
 *
 * Просроченные партии не показываются намеренно. Продажа берёт товар по FEFO и
 * просроченное обходит — значит покупателю оно не достанется, и писать о нём
 * на кнопке «продать» значит пугать тем, чего не произойдёт. Где просрочка
 * лежит и что с ней делать — отдельный разговор и отдельный экран.
 */
export interface SoonExpiring {
  /** Дата ближайшей непросроченной партии, как её прислал сервер. */
  expiryDate: string;
  /** Сколько в ней осталось: одна пачка на исходе — не то же, что сорок. */
  quantity: number;
}

export function expiringSoonByProduct(batches: Batch[]): Map<string, SoonExpiring> {
  const nearest = new Map<string, SoonExpiring>();

  for (const batch of batches) {
    // Пустая партия ничего не отпустит — о ней говорить незачем.
    if (batch.quantity <= 0) continue;
    // Просроченное продажа обходит, а `ok` не о чем предупреждать.
    if (batch.status !== 'expiring_soon') continue;

    const known = nearest.get(batch.productId);
    if (!known || batch.expiryDate < known.expiryDate) {
      nearest.set(batch.productId, { expiryDate: batch.expiryDate, quantity: batch.quantity });
      continue;
    }
    // Две партии с одной датой — это одна и та же новость, и остаток по ней
    // общий: иначе фармацевт увидит «осталось 2», отпустит три и удивится.
    if (batch.expiryDate === known.expiryDate) {
      nearest.set(batch.productId, {
        expiryDate: known.expiryDate,
        quantity: known.quantity + batch.quantity,
      });
    }
  }

  return nearest;
}

/**
 * Дата как её читают в аптеке: «12.10».
 *
 * Без года намеренно: на кнопке места мало, а срок, до которого осталось мало,
 * по определению в этом году или в начале следующего. Год важен там, где
 * партию принимают и списывают, — и там он есть.
 */
export function shortDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getUTCDate())}.${pad(at.getUTCMonth() + 1)}`;
}
