/**
 * Начальный остаток — та часть полки, которую не объясняет ни одно движение.
 *
 * Товар лежал на полке до того, как система появилась. Сказать об этом
 * движением — единственный способ сделать прослеживаемой каждую следующую
 * цифру: сверка остатка с журналом спрашивает ровно одно, «откуда это здесь», и
 * полка без объяснения отвечает «неоткуда».
 *
 * **Сравнивается сумма движений, а не их наличие.** Полка считалась
 * объяснённой, если по ней есть хоть одно движение. Демо-день пишет их сам:
 * сахар лёг остатком в сорок мешков, потом два ушли продажей — и полка
 * становилась «объяснённой» этими двумя. Сорок мешков исчезали из журнала
 * навсегда.
 *
 * Ловит это ровно та проверка, ради которой всё писалось: `backup.mjs verify`
 * на демо-базе падал строкой «остаток не сходится с журналом: 7 строк». То есть
 * проверка, по которой владелец решает, можно ли доверять копии, кричала на
 * каждой копии — а значит настоящую поломку в ней было не отличить.
 *
 * Найдено 30.09.2026 при проверке разворачивания копии.
 */

export interface ShelfRow {
  productId: string;
  locationId: string;
  binLocation: string;
  quantity: number;
}

export interface MovedRow {
  productId: string;
  locationId: string;
  binLocation: string;
  /** Сумма движений по этой полке, со знаком. */
  quantity: number;
}

export interface OpeningEntry {
  productId: string;
  locationId: string;
  binLocation: string;
  /** Сколько дописать движением. Всегда больше нуля. */
  quantity: number;
}

export interface OpeningPlan {
  /** Что записать движением «opening». */
  opening: OpeningEntry[];
  /**
   * Полки, где журнал обещает больше, чем лежит.
   *
   * Начальным остатком это не объясняется: движение с минусом здесь было бы не
   * фактом, а замазанной поломкой. Поэтому такие строки только называются
   * вслух — чинить их надо там, где они появились.
   */
  short: ShelfRow[];
}

const shelf = (row: { productId: string; locationId: string; binLocation: string }) =>
  `${row.locationId}|${row.binLocation}|${row.productId}`;

export function planOpeningBalances(rows: ShelfRow[], moved: MovedRow[]): OpeningPlan {
  const byShelf = new Map(moved.map((row) => [shelf(row), row.quantity]));
  const opening: OpeningEntry[] = [];
  const short: ShelfRow[] = [];

  for (const row of rows) {
    const unexplained = row.quantity - (byShelf.get(shelf(row)) ?? 0);
    if (unexplained > 0) {
      opening.push({
        productId: row.productId,
        locationId: row.locationId,
        binLocation: row.binLocation,
        quantity: unexplained,
      });
    } else if (unexplained < 0) {
      short.push(row);
    }
  }

  return { opening, short };
}
