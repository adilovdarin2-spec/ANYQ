import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBuyer, loadCart, saveBuyer, saveCart, reconcileCart } from './cart-storage';
import type { CartLine, Catalog } from './types';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Корзина витрины переживает перезагрузку.
 *
 * Она жила только в памяти React. Телефон выгружает фоновую вкладку сам, без
 * предупреждения: закупщик, набравший сорок строк и переключившийся в WhatsApp
 * уточнить у директора, возвращался к пустому каталогу. Это потерянный заказ и
 * звонок по телефону — то, от чего витрина и должна избавлять.
 *
 * Хранилище в этом приложении уже было — в нём лежит токен кабинета.
 */

/** Хранилище в памяти: тестовой среды с браузером в этом проекте нет. */
function подменитьХранилище(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

const строка = (over: Partial<CartLine> = {}): CartLine => ({
  productId: 'p1',
  name: 'Сахар 1 кг',
  price: 450,
  unit: 'кг',
  qty: 3,
  maxStock: 100,
  ...over,
});

describe('корзина в хранилище', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = подменитьХранилище();
  });

  it('сохраняется и поднимается обратно', () => {
    const cart = [строка(), строка({ productId: 'p2', name: 'Мука' })];
    saveCart('c1', cart);
    expect(loadCart('c1')).toEqual(cart);
  });

  it('и лежит по компании, а не одна на всех', () => {
    /* У одного закупщика бывает два поставщика в двух вкладках. Сложить их
       заказы в одну корзину — значит отправить одному то, что просили у другого. */
    saveCart('c1', [строка({ name: 'У первого' })]);
    saveCart('c2', [строка({ name: 'У второго' })]);
    expect(loadCart('c1')[0].name).toBe('У первого');
    expect(loadCart('c2')[0].name).toBe('У второго');
  });

  it('пустая корзина хранилище не занимает', () => {
    saveCart('c1', [строка()]);
    saveCart('c1', []);
    expect(store.size).toBe(0);
    expect(loadCart('c1')).toEqual([]);
  });

  it('испорченная строка не отнимает остальные', () => {
    /* В хранилище мог остаться заказ, собранный прошлой версией витрины. Одна
       строка без количества не повод потерять тридцать девять годных. */
    store.set(
      'anyq.storefront.cart.c1',
      JSON.stringify([строка(), { productId: 'p9' }, строка({ productId: 'p3', qty: 0 }), строка({ productId: 'p4' })]),
    );
    const поднято = loadCart('c1');
    expect(поднято.map((l) => l.productId)).toEqual(['p1', 'p4']);
  });

  it('и мусор целиком читается как пустая корзина', () => {
    for (const мусор of ['не json', '{}', 'null', '42', '"строка"']) {
      store.set('anyq.storefront.cart.c1', мусор);
      expect(loadCart('c1'), мусор).toEqual([]);
    }
  });

  it('а запрещённое хранилище витрину не ломает', () => {
    /* Приватное окно и запрет на сайт — обычное дело. Витрина обязана работать
       и без памяти, просто без сохранённой корзины. */
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(() => saveCart('c1', [строка()])).not.toThrow();
    expect(loadCart('c1')).toEqual([]);
  });

  it('и без компании ничего не пишется', () => {
    // Витрина открывается по ссылке компании; без неё писать некуда.
    saveCart(null, [строка()]);
    expect(store.size).toBe(0);
    expect(loadCart(null)).toEqual([]);
  });
});

const каталог = (products: { id: string; price: number; stock: number; unit: string }[]): Catalog =>
  ({ company: { name: 'Поставщик' }, products } as unknown as Catalog);

describe('сведение корзины со свежим каталогом', () => {
  it('подтягивает цену и остаток', () => {
    /* Показывать вчерашнюю цену — обманывать, а разрешать «+» выше склада —
       обещать невозможное. */
    const { cart, problems } = reconcileCart(
      каталог([{ id: 'p1', price: 500, stock: 40, unit: 'кг' }]),
      [строка({ price: 450, maxStock: 100 })],
    );
    expect(cart[0].price).toBe(500);
    expect(cart[0].maxStock).toBe(40);
    expect(problems).toEqual([]);
  });

  it('называет строку, которой больше нет, но её не вычёркивает', () => {
    /* Заказ чужой. Вычёркивать из него за человека — это ровно то, чем занимался
       сервер, когда молча выбрасывал строки из заказа. */
    const { cart, problems } = reconcileCart(каталог([]), [строка({ name: 'Сахар 1 кг' })]);
    expect(problems).toEqual(['Сахар 1 кг']);
    expect(cart, 'строку убрали за покупателя').toHaveLength(1);
  });

  it('и говорит, когда осталось меньше, чем просят', () => {
    const { problems } = reconcileCart(
      каталог([{ id: 'p1', price: 450, stock: 2, unit: 'кг' }]),
      [строка({ qty: 3 })],
    );
    expect(problems).toEqual(['Сахар 1 кг — осталось 2 кг']);
  });

  it('а на пустой корзине молчит', () => {
    expect(reconcileCart(каталог([{ id: 'p1', price: 1, stock: 1, unit: 'шт' }]), [])).toEqual({
      cart: [],
      problems: [],
    });
  });
});

describe('кто заказывает', () => {
  beforeEach(() => {
    подменитьХранилище();
  });

  it('запоминается и подставляется в следующий раз', () => {
    /* Опт — это один и тот же человек, магазин и адрес каждую неделю. Пустой
       лист означал, что это набирают заново с телефона перед каждым заказом. */
    saveBuyer('c1', { name: 'ТОО «Береке»', phone: '+77001234567', address: 'Алматы, Абая 10' });
    expect(loadBuyer('c1')).toEqual({
      name: 'ТОО «Береке»',
      phone: '+77001234567',
      address: 'Алматы, Абая 10',
    });
  });

  it('и тоже по компании', () => {
    // Адрес доставки одному поставщику может быть не тем, что другому.
    saveBuyer('c1', { name: 'А', phone: '1', address: 'склад' });
    saveBuyer('c2', { name: 'Б', phone: '2', address: 'магазин' });
    expect(loadBuyer('c1').address).toBe('склад');
    expect(loadBuyer('c2').address).toBe('магазин');
  });

  it('а чего нет — то пустая строка, а не «undefined» в поле', () => {
    /* Подставить в поле телефона не строку значило бы сломать лист оформления,
       а не просто не помочь. */
    expect(loadBuyer('c9')).toEqual({ name: '', phone: '', address: '' });
    expect(loadBuyer(null)).toEqual({ name: '', phone: '', address: '' });
  });

  it('и мусор в хранилище не доезжает до полей', () => {
    const store = подменитьХранилище();
    for (const мусор of ['не json', '42', 'null', '{"name":{"его":"зовут"}}']) {
      store.set('anyq.storefront.buyer.c1', мусор);
      const b = loadBuyer('c1');
      expect(typeof b.name, мусор).toBe('string');
      expect(typeof b.phone, мусор).toBe('string');
      expect(typeof b.address, мусор).toBe('string');
    }
  });
});

describe('витрина пользуется этим, а не своей копией', () => {
  const app = withoutComments(
    readFileSync(resolve(__dirname, 'App.tsx'), 'utf8').replace(/\r\n/g, '\n'),
  );

  it('поднимает корзину при первом рендере', () => {
    expect(app).toContain('useState<CartLine[]>(() => loadCart(getCompanyId()))');
  });

  it('и сохраняет её на каждое изменение, а не на отправку', () => {
    // Смысл в том, чтобы пережить закрытие вкладки, о котором не предупреждают.
    expect(app).toContain('saveCart(companyId, cart);');
    expect(app).toContain('}, [companyId, cart]);');
  });

  it('подставляет прошлые данные в лист оформления', () => {
    expect(app).toContain('loadBuyer(getCompanyId())');
    expect(app).toContain('buyer={buyer}');
  });

  it('и лист их правда берёт, а не просто получает', () => {
    /* Передать и не использовать — ровно то, что эта охрана пропустила в первой
       своей версии: витрина отдавала данные, а лист открывался пустым. */
    const лист = withoutComments(readFileSync(resolve(__dirname, 'components', 'CheckoutSheet.tsx'), 'utf8'));
    for (const поле of ['name', 'phone', 'address']) {
      expect(лист, `поле ${поле} не подставляется`).toContain(`useState(buyer?.${поле} ?? '')`);
    }
  });

  it('и запоминает их только после того, как сервер заказ принял', () => {
    /* Сохранив отвергнутое, мы подставляли бы в следующий заказ данные, из-за
       которых отказали. */
    const после = app.slice(app.indexOf('setOrderNumber(placed.number'));
    expect(после.slice(0, после.indexOf('setView('))).toContain('saveBuyer(companyId,');
  });

  it('и сводит с каталогом одним правилом в оба случая', () => {
    /* Восстановление из хранилища и перечитывание после отказа сервера — про
       одно и то же: страница открыта со вчера. Две копии этого правила однажды
       разошлись бы. */
    expect([...app.matchAll(/reconcileCart\(/g)]).toHaveLength(2);
  });
});
