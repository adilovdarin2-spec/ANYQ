import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Коробки из выгрузки доезжают до базы.
 *
 * Разбор проверен отдельно, в `import-packaging`. Здесь — то, чего он доказать
 * не может: что маршрут их пишет, что повторный импорт правит коробку, а не
 * заводит вторую, и что упаковка появляется и у товара, который уже был.
 *
 * Последнее — обычный порядок вещей: каталог заводят одним файлом, а прайс с
 * упаковками присылают позже.
 */

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
});

const ЗАГОЛОВОК = ['Наименование', 'Штрихкод', 'Цена', 'В упаковке', 'Упаковка', 'Штрихкод упаковки'];

async function ввезти(строки: string[][]) {
  const res = await api(fx.token, 'POST', '/pos/import/products', {
    locationId: fx.locationId,
    grid: [ЗАГОЛОВОК, ...строки],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function упаковкиТовара(name: string) {
  const product = await prisma.product.findFirstOrThrow({ where: { companyId: fx.companyId, name } });
  return prisma.productPackaging.findMany({ where: { productId: product.id }, orderBy: { name: 'asc' } });
}

describe('упаковки при импорте', () => {
  it('заводятся вместе с товаром', async () => {
    const итог = await ввезти([
      ['Сигареты «Астана»', '4870201', '1400', '10', 'Блок', '4006381333931'],
      ['Сок «Дар» 1 л', '4870202', '500', '12', 'Ящик', ''],
      ['Ручка', '4870203', '150', '', '', ''],
    ]);
    expect(итог.created).toBe(3);
    expect(итог.packagingsCreated).toBe(2);

    const блок = await упаковкиТовара('Сигареты «Астана»');
    expect(блок).toHaveLength(1);
    expect(блок[0].name).toBe('Блок');
    expect(блок[0].unitsPerPack).toBe(10);
    expect(блок[0].barcode).toBe('4006381333931');

    const ящик = await упаковкиТовара('Сок «Дар» 1 л');
    expect(ящик[0].unitsPerPack).toBe(12);
    expect(ящик[0].barcode, 'штрихкода у этой коробки в файле не было').toBeNull();

    expect(await упаковкиТовара('Ручка'), 'штучный товар получил коробку').toEqual([]);
  });

  it('повторный импорт правит коробку, а не заводит вторую', async () => {
    /* Прайс присылают заново, и в нём «в коробке» стало шесть вместо двенадцати.
       Заведя вторую коробку с тем же именем, мы дали бы кладовщику выбор из двух
       одинаковых строк, одна из которых врёт. */
    await ввезти([['Сок «Дар» 1 л', '4870202', '500', '12', 'Ящик', '']]);
    const итог = await ввезти([['Сок «Дар» 1 л', '4870202', '500', '6', 'Ящик', '4006381333931']]);

    expect(итог.updated).toBe(1);
    expect(итог.packagingsCreated).toBe(0);
    expect(итог.packagingsUpdated).toBe(1);

    const ящик = await упаковкиТовара('Сок «Дар» 1 л');
    expect(ящик, 'завелась вторая коробка с тем же именем').toHaveLength(1);
    expect(ящик[0].unitsPerPack).toBe(6);
    expect(ящик[0].barcode).toBe('4006381333931');
  });

  it('и заводится у товара, который уже был', async () => {
    await ввезти([['Чай «Асем»', '4870204', '600', '', '', '']]);
    expect(await упаковкиТовара('Чай «Асем»')).toEqual([]);

    const итог = await ввезти([['Чай «Асем»', '4870204', '600', '24', 'Коробка', '']]);
    expect(итог.updated).toBe(1);
    expect(итог.packagingsCreated).toBe(1);
    expect((await упаковкиТовара('Чай «Асем»'))[0].unitsPerPack).toBe(24);
  });

  it('а разные имена — это разные коробки одного товара', async () => {
    // Блок и ящик одновременно: так и приходит сигаретный товар.
    await ввезти([['Сигареты «Астана»', '4870201', '1400', '10', 'Блок', '']]);
    await ввезти([['Сигареты «Астана»', '4870201', '1400', '50', 'Ящик', '']]);

    const коробки = await упаковкиТовара('Сигареты «Астана»');
    expect(коробки.map((p) => [p.name, p.unitsPerPack])).toEqual([
      ['Блок', 10],
      ['Ящик', 50],
    ]);
  });

  it('и плохое число в упаковке не уносит с собой товар', async () => {
    /* Главное правило этой части: ошибка в соседнем столбце не стоит товара. */
    const итог = await ввезти([['Соль', '4870205', '120', 'много', 'Пачка', '']]);
    expect(итог.created).toBe(1);
    expect(итог.packagingsCreated).toBe(0);
    expect(итог.problemCount).toBeGreaterThan(0);

    const товар = await prisma.product.findFirst({ where: { companyId: fx.companyId, name: 'Соль' } });
    expect(товар, 'товар потерян из-за упаковки').toBeTruthy();
    expect(await упаковкиТовара('Соль')).toEqual([]);
  });
});
