import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';
import { request as httpRequest } from 'node:http';

/**
 * Ответы сервера уходят сжатыми.
 *
 * Касса возит каталог целиком — без этого она не смогла бы торговать без сети —
 * и перечитывает его, пока смена открыта. Замер до этой правки: 500 товаров —
 * 161 КБ, 3000 — 965 КБ, 10 000 — 3,2 МБ на один ответ, и ничего из этого не
 * сжималось: ни сервер, ни край Railway тела не трогали. Планшет на складе
 * сидит на мобильном интернете, и оптовику с тремя тысячами позиций это
 * считается деньгами.
 *
 * Проверяется по проводу, а не по заголовку: `fetch` в Node распаковывает тело
 * сам, поэтому «сжато» через него выглядит точно так же, как «не сжато». Здесь
 * считаются байты, реально пришедшие в сокет.
 */

let fx: Fixture;
let base = '';

beforeAll(async () => {
  base = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
});

interface RawResponse {
  bytes: number;
  encoding: string;
  status: number;
}

function rawGet(url: string, headers: Record<string, string>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
      });
      res.on('end', () =>
        resolve({
          bytes,
          encoding: String(res.headers['content-encoding'] ?? 'нет'),
          status: res.statusCode ?? 0,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function addProducts(n: number) {
  await prisma.product.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      companyId: fx.companyId,
      name: `Товар ${i} — торговое наименование подлиннее`,
      category: `Категория ${i % 20}`,
      unit: 'шт',
      barcode: `299${String(i).padStart(10, '0')}`,
      purchasePrice: 100 + (i % 500),
      salePrice: 200 + (i % 900),
    })),
  });
}

describe('сжатие ответов', () => {
  it('каталог на сотни товаров уходит сжатым и весит в разы меньше', async () => {
    await addProducts(600);
    const url = `${base}/pos/catalog?locationId=${fx.locationId}`;
    const auth = { Authorization: `Bearer ${fx.token}` };

    const сжатый = await rawGet(url, { ...auth, 'Accept-Encoding': 'gzip' });
    const обычный = await rawGet(url, { ...auth, 'Accept-Encoding': 'identity' });

    expect(сжатый.status).toBe(200);
    expect(сжатый.encoding).toBe('gzip');
    expect(обычный.encoding).toBe('нет');

    // Страховка на сам замер: если каталог вдруг окажется пустым, обе величины
    // будут крошечными и сравнение ничего не докажет.
    expect(обычный.bytes).toBeGreaterThan(100_000);
    // Осторожная граница. На этих данных выходит примерно в шестнадцать раз;
    // проверяем втрое, чтобы тест ловил «сжатие выключили», а не колебания
    // словаря gzip на других именах товаров.
    expect(сжатый.bytes * 3).toBeLessThan(обычный.bytes);
  });

  it('касса, которая не просит сжатия, получает обычный ответ', async () => {
    // Старый клиент или прокси, не понимающий gzip: ответ обязан остаться
    // читаемым, а не прийти сжатым в надежде, что разберутся.
    const ответ = await rawGet(`${base}/pos/catalog?locationId=${fx.locationId}`, {
      Authorization: `Bearer ${fx.token}`,
      'Accept-Encoding': 'identity',
    });
    expect(ответ.status).toBe(200);
    expect(ответ.encoding).toBe('нет');
  });

  it('мелкий ответ не сжимается — от этого он только толще', async () => {
    const ответ = await rawGet(`${base}/health`, { 'Accept-Encoding': 'gzip' });
    expect(ответ.status).toBe(200);
    expect(ответ.encoding).toBe('нет');
  });
});
