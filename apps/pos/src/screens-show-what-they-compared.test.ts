import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Экран, показывающий число, показывает и то, из чего оно сложилось.
 *
 * Правило это в репозитории уже записано — на закрытии смены: «итог без
 * слагаемых читается как произвол». Здесь оно закреплено для двух экранов, где
 * его не применили, хотя сервер присылал всё нужное.
 *
 * Первый — прайс-лист.
 *
 * Строка показывала цену поставщика и процент: «520 ₸ +15 %». Процент просит
 * доверия к подписи, а подпись обещала «на сколько дороже нашей последней
 * закупки» — чего не было. Сравнение идёт с закупочной ценой из карточки товара,
 * а приёмка её не меняет: настоящая история цен живёт в строках приёмок. То есть
 * это учётная цена, а не последняя уплаченная.
 *
 * Сервер присылал всё нужное, чтобы сказать правду, — `ourPurchasePrice`,
 * `ourUnit`, `matchedBy`, — и экран не читал ни одного из трёх. Теперь оба числа
 * и обе единицы стоят рядом: верить нечему, видно.
 *
 * Единица важнее процента. У поставщика килограмм, у нас упаковка — «+15 %»
 * между ними не значит ничего, и без единиц это не разглядеть.
 */

const SCREEN = resolve(__dirname, 'components', 'PriceListScreen.tsx');
const screen = withoutComments(readFileSync(SCREEN, 'utf8').replace(/\r\n/g, '\n'));

describe('строка прайс-листа', () => {
  it('экран вообще разобрался', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(screen).toContain('priceChangePercent');
    expect(screen.length).toBeGreaterThan(2000);
  });

  it('показывает нашу цену рядом с ценой поставщика', () => {
    expect(screen, 'процент остался без второго числа').toContain('line.ourPurchasePrice !== null');
    expect(screen).toContain("t('priceList.ours'");
  });

  it('и нашу единицу — иначе процент сравнивает килограмм с упаковкой', () => {
    expect(screen).toContain('line.ourUnit');
  });

  it('и говорит, когда товар узнан по названию, а не по штрихкоду', () => {
    /* Штрихкод определяет товар, название набирал человек — у нас один, у
       поставщика другой. Не сказав этого, экран предлагает количество и
       сравнивает цены, не объяснив, про какой товар речь. */
    expect(screen).toContain("line.matchedBy === 'name'");
    expect(screen).toContain("t('priceList.matchedByName')");
  });

  it('а по штрихкоду — молчит: там сказать нечего', () => {
    // Отметка у каждой строки перестала бы быть отметкой.
    expect(screen, 'отметка ставится всем подряд').not.toContain("matchedBy === 'barcode'");
  });

  it('фразы есть на двух языках и называют оба поля', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      const наша = (d as Record<string, string>)['priceList.ours'];
      expect(наша, `${язык}: нет фразы про нашу цену`).toBeTruthy();
      expect(наша, `${язык}: цена не подставляется`).toContain('{price}');
      expect(наша, `${язык}: единица не подставляется`).toContain('{unit}');
      expect((d as Record<string, string>)['priceList.matchedByName'], `${язык}: нет фразы про совпадение`).toBeTruthy();
    }
  });

  /* Описание поля в `types.ts` тоже исправлено — оно обещало «нашу последнюю
     закупку», чего не считалось никогда. Проверки на это здесь нет намеренно:
     охраны в этом репозитории читают исходник **без** комментариев, и стеречь
     текст пояснения ими нельзя. Первая версия этого файла попробовала — и
     упала на том, что сама же отсекла.

     Так и правильно: комментарий не поведение. Поведение — что рядом с
     процентом стоят оба числа и обе единицы, и это проверено выше. */
});

/**
 * Сальдо показывает, из чего сложилось.
 *
 * Стояло одно число: «Должен 8 500». По такому нельзя ни спорить, ни
 * соглашаться, а спорят по нему постоянно — это опт, и у контрагента своя
 * тетрадь. Сервер присылал `charged` и `paid`, экран не читал ни одного.
 *
 * Что разность даёт сальдо в точности, проверено арифметикой в
 * `api/balance-adds-up`; здесь — что строка на экране есть.
 */
describe('карточка расчётов', () => {
  const settlements = withoutComments(
    readFileSync(resolve(__dirname, 'components', 'SettlementsScreen.tsx'), 'utf8'),
  );

  it('экран разобрался', () => {
    expect(settlements).toContain('account.balance');
  });

  it('показывает начисленное и оплаченное', () => {
    expect(settlements, 'сальдо снова стоит одно').toContain('account.charged');
    expect(settlements).toContain('account.paid');
    expect(settlements).toContain("t('settle.chargedPaid')");
  });

  it('но не на пустом счёте', () => {
    // «Начислено 0 − оплачено 0» — строка, которая заставляет искать, чего не было.
    expect(settlements).toContain('account.charged > 0');
  });

  it('и фраза есть на двух языках', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      expect((d as Record<string, string>)['settle.chargedPaid'], `${язык}: нет фразы`).toBeTruthy();
    }
  });

  /* И по каким документам сложилось.

     Сальдо со слагаемыми отвечает «сколько», а на сверке спрашивают «по каким
     накладным» — у контрагента своя тетрадь, и спорят построчно. Выписку сервер
     считал с самого начала и не отдавал никому: маршрут стоял без единого
     вызова, а экран показывал итог. Что маршрут вообще кто-то зовёт, стережёт
     `scripts/every-route-has-a-caller`; здесь — что строки видно. */
  it('и показывает сами документы, когда их попросили', () => {
    expect(settlements, 'выписка снова никем не запрашивается').toContain('onShowStatement');
    expect(settlements).toContain('statement.charges.map');
    expect(settlements).toContain('statement.payments.map');
  });

  it('и не грузит их вместе со списком', () => {
    /* В список заходят каждый день, чтобы понять, кому звонить. Сто накладных
       по каждому из сорока должников ради этого тянуть нельзя — и на слабой
       связи это не оптимизация, а разница между «открылось» и «висит». */
    expect(settlements, 'выписка разворачивается всем сразу').toContain('statementFor !== account.counterpartyId');
  });

  it('и говорит по накладной, сколько из неё уже закрыто', () => {
    // Без этого строка не отличает спорную накладную от оплаченной.
    expect(settlements).toContain('charge.settled > 0');
    expect(settlements).toContain("t('settle.ofItPaid'");
  });

  it('и фразы выписки есть на двух языках', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      const словарь = d as Record<string, string>;
      for (const ключ of ['settle.showDocuments', 'settle.hideDocuments', 'settle.noDocuments', 'settle.document', 'settle.payment']) {
        expect(словарь[ключ], `${язык}: нет фразы ${ключ}`).toBeTruthy();
      }
      expect(словарь['settle.ofItPaid'], `${язык}: сумма не подставляется`).toContain('{amount}');
    }
  });
});

/**
 * Автозаказ показывает, из чего сложилась скорость продаж.
 *
 * В шапке стоит «продаёте 2,9 в день, запаса на 4 дн.», и по этому числу
 * владелец решает, заказывать сорок или сто. Проверить его было нечем: сервер
 * присылал `soldInStock` и `daysInStock`, экран не читал ни одного и показывал
 * только результат. Рекомендацию без основания либо принимают на веру, либо не
 * пользуются ею вовсе.
 *
 * Что деление сходится в точности, проверено арифметикой в
 * `api/demand-rate-adds-up`; здесь — что строка на экране есть и что числитель
 * взят тот, который делится.
 */
describe('карточка автозаказа', () => {
  const repl = withoutComments(
    readFileSync(resolve(__dirname, 'components', 'ReplenishmentScreen.tsx'), 'utf8'),
  );

  it('экран разобрался', () => {
    expect(repl).toContain('demandPerDay');
  });

  it('показывает проданное и дни на полке', () => {
    expect(repl, 'скорость снова стоит одна').toContain('item.soldInStock');
    expect(repl).toContain('item.daysInStock');
    expect(repl).toContain("t('repl.soldPerDayBasis')");
  });

  it('и числитель берёт тот, который делится', () => {
    /* `soldInWindow` считает и возвраты в дни с пустой полкой, а скорость
       делится из проданного в дни на полке. Поставь в числитель итог за окно —
       и владелец, поделив, получит не то число, что в шапке: строка, ради
       которой всё это делалось, начнёт опровергать рекомендацию. */
    const строка = repl.slice(repl.indexOf("t('repl.soldPerDayBasis')"));
    const конец = строка.indexOf('</div>');
    expect(строка.slice(0, конец), 'в числителе итог за окно').not.toContain('soldInWindow');
  });

  it('и не рисуется, когда делить не на что', () => {
    // «0 ÷ 0» рядом с рекомендацией хуже, чем её отсутствие.
    expect(repl).toContain('item.daysInStock > 0');
  });

  it('и переживает кассу на версию старше сервера', () => {
    /* Касса и API выкатываются порознь. Поле необязательное, и строка обязана
       пропускаться, а не печатать «undefined ÷ 28». */
    expect(repl).toContain('item.soldInStock !== undefined');
  });

  it('и фразы есть на двух языках', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      expect((d as Record<string, string>)['repl.soldPerDayBasis'], `${язык}: нет фразы про основание`).toBeTruthy();
      const окно = (d as Record<string, string>)['repl.soldInWindow'];
      expect(окно, `${язык}: нет фразы про окно`).toBeTruthy();
      expect(окно, `${язык}: число дней не подставляется`).toContain('{days}');
    }
  });

  /* И про заказ, которого уже не будет.

     Заказанное вычитается из потребности — верно, пока поставка едет. Срока у
     вычитания не было: мартовский заказ вычитался в сентябре, полка стояла
     пустой, а экран отвечал «заказывать не надо». Правило проверено арифметикой
     в `api/order-we-stopped-waiting-for` и по живой базе в
     `integration/stale-order-stops-blocking`; здесь — что исчезло оно не молча. */
  it('и говорит, какой заказ перестал считаться', () => {
    expect(repl, 'просроченный заказ исчезает молча').toContain('item.onOrderOverdue');
    expect(repl).toContain("t('repl.onOrderOverdue')");
    expect(repl, 'сказано, что число изменилось, и не сказано, что делать').toContain("t('repl.overdueWhy')");
  });

  it('но молчит, когда пропавшего заказа нет', () => {
    // Строка «уже не ждём: 0» заставляет искать то, чего не было.
    expect(repl).toContain('(item.onOrderOverdue ?? 0) > 0');
  });

  it('и фразы про пропавший заказ есть на двух языках', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      expect((d as Record<string, string>)['repl.onOrderOverdue'], `${язык}: нет фразы`).toBeTruthy();
      expect((d as Record<string, string>)['repl.overdueWhy'], `${язык}: нет объяснения`).toBeTruthy();
    }
  });
});

/**
 * Заказ поставщику принимает дату, к которой его обещали.
 *
 * Сервер принимал `expectedAt` с самого начала, и задать её было негде: касса
 * поле не читала и не отправляла. От этой даты зависит, когда заказ перестаёт
 * считаться едущим и снимать потребность, — то есть без неё срок берётся из
 * общего правила вместо того, что поставщик сказал про этот заказ.
 */
describe('заказ поставщику', () => {
  const po = withoutComments(
    readFileSync(resolve(__dirname, 'components', 'PurchaseOrdersScreen.tsx'), 'utf8'),
  );

  it('экран разобрался', () => {
    expect(po).toContain('onCreate');
  });

  it('спрашивает, когда ждём поставку', () => {
    expect(po, 'дата снова не задаётся ниоткуда').toContain("t('po.expectedAt')");
    expect(po).toContain('expectedAt: expectedAt || null');
  });

  it('и показывает её в списке заказов', () => {
    // Иначе нельзя понять, какой из десяти открытых заказов опаздывает.
    expect(po).toContain('order.expectedAt');
    expect(po).toContain("t('po.expecting'");
  });

  it('и фразы есть на двух языках', () => {
    for (const [язык, d] of [['русский', ru], ['казахский', kk]] as const) {
      expect((d as Record<string, string>)['po.expectedAt'], `${язык}: нет подписи поля`).toBeTruthy();
      expect((d as Record<string, string>)['po.expectedWhy'], `${язык}: не сказано, зачем дата`).toBeTruthy();
      expect((d as Record<string, string>)['po.expecting'], `${язык}: дата не подставляется`).toContain('{date}');
    }
  });
});
