import type { Sale } from './types';
import { splitQueue } from './sales-queue';

/**
 * Сколько чеков касса держит у себя.
 *
 * Не держала ничего лишнего только потому, что не удаляла ничего вообще:
 * массив продаж в localStorage рос с первого дня и до конца. Магазин на
 * триста чеков в день набирает мегабайт за неделю, а браузер даёт origin
 * около пяти — то есть через месяц-полтора работы `localStorage.setItem`
 * начинает бросать QuotaExceededError. Бросает он его внутри `addSale`, то
 * есть в тот момент, когда кассир нажал «Оплатить»: чек не сохранён, экран
 * чека не открылся, деньги взяты. И так на каждой следующей продаже, пока
 * кто-нибудь не догадается очистить данные сайта — вместе с неотправленными
 * продажами.
 *
 * Вдобавок каждый `addSale` переписывает весь массив целиком, а каждый
 * `getSales` разбирает его заново, по несколько раз за синхронизацию. К тому
 * же мегабайту это уже заметно на планшете за 40 000 ₸.
 *
 * Поэтому: неотправленное не трогаем никогда — это единственная копия
 * продажи, которой нет на сервере. Отправленное держим несколько дней: столько
 * живёт вопрос «покажи вчерашний чек», а возвраты и отчёты всё равно идут с
 * сервера.
 */

/** Отправленные чеки держим трое суток: вчера, позавчера и с запасом. */
export const KEEP_SYNCED_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Потолок на всё вместе.
 *
 * Нужен для случая, когда отправлять некуда неделю: неотправленных чеков
 * может накопиться столько, что места не хватит и без старых. Обрезать их
 * нельзя, поэтому потолок стоит с запасом и служит только против того, чтобы
 * отправленные чеки заняли место, нужное неотправленным.
 */
export const KEEP_MAX = 3000;

/**
 * Что оставить в памяти кассы.
 *
 * Порядок сохраняется: экран чека ищет продажу по идентификатору, а закрытие
 * смены считает по ним деньги.
 */
export function pruneSales(sales: Sale[], now: number = Date.now(), openShiftId?: string | null): Sale[] {
  const { pending, stuck } = splitQueue(sales);
  const unsynced = pending.length + stuck.length;

  const kept = sales.filter((sale) => {
    if (!sale.synced || sale.syncError) return true;
    // Смену, которая ещё открыта, не трогаем совсем. Касса просит закрыть её
    // через двадцать часов, но просить — не значит закрыть: смена, забытая на
    // несколько дней, — обычное дело. Если из неё пропадут первые чеки,
    // ожидаемая сумма в ящике упадёт, и кассир получит излишек на ровном месте.
    if (openShiftId && sale.shiftId === openShiftId) return true;
    return now - new Date(sale.createdAt).getTime() < KEEP_SYNCED_MS;
  });
  if (kept.length <= KEEP_MAX) return kept;

  // Места всё равно мало. Режем самые старые из отправленных — и только их:
  // неотправленный чек существует в одном экземпляре, и стереть его значит
  // стереть продажу.
  const excess = kept.length - Math.max(KEEP_MAX, unsynced);
  if (excess <= 0) return kept;

  let dropped = 0;
  return kept.filter((sale) => {
    if (dropped >= excess) return true;
    if (!sale.synced || sale.syncError) return true;
    if (openShiftId && sale.shiftId === openShiftId) return true;
    dropped += 1;
    return false;
  });
}

/**
 * Сколько отправленных чеков оставить, когда места нет совсем.
 *
 * Не ноль: по этим чекам считается касса на закрытии смены. Выбросить их все
 * значит занизить ожидаемую сумму в ящике и показать кассиру излишек, которого
 * нет. Пятисот хватает на смену любого магазина, для которого эта касса
 * писалась, и это всё равно около одного процента от того, что переполнило
 * хранилище.
 */
export const KEEP_ON_OVERFLOW = 500;

/**
 * Последнее средство: место кончилось прямо сейчас.
 *
 * Оставляем всё, чего нет на сервере, и хвост недавних отправленных. Если и
 * это не влезет — значит не влезет ничего, и касса обязана сказать об этом
 * вслух, а не потерять чек.
 */
export function keepOnlyUnsent(sales: Sale[], keepSynced: number = KEEP_ON_OVERFLOW): Sale[] {
  let allowance = keepSynced;
  const kept: Sale[] = [];
  // С конца: свежие отправленные чеки — это текущая смена.
  for (let i = sales.length - 1; i >= 0; i--) {
    const sale = sales[i];
    if (!sale.synced || sale.syncError) {
      kept.push(sale);
      continue;
    }
    if (allowance > 0) {
      allowance -= 1;
      kept.push(sale);
    }
  }
  return kept.reverse();
}

/** Переполнение хранилища, а не любая другая беда с localStorage. */
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Firefox и Safari называют это по-своему, а Safari в приватном режиме
  // отдаёт код 22 вообще без внятного имени.
  const name = err.name;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (err as { code?: number }).code === 22 ||
    (err as { code?: number }).code === 1014
  );
}
