import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, resetDatabase, startTestServer, stopTestServer } from './harness';
import { resetMetrics } from '../metrics-store';
import type { Fixture } from './harness';

let fx: Fixture;
let baseUrl = '';
const SECRET = 'test-maintenance-secret';

beforeAll(async () => {
  process.env.MAINTENANCE_SECRET = SECRET;
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  resetMetrics();
  fx = await createFixture({ openingQuantity: 100 });
});

async function metrics() {
  const res = await fetch(`${baseUrl}/metrics`, { headers: { 'x-maintenance-secret': SECRET } });
  return { status: res.status, body: await res.json() as any };
}

describe('what the server reports about itself', () => {
  it('counts the requests it served and times them', async () => {
    await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);

    const { body } = await metrics();
    const route = body.routes.find((r: any) => r.route === 'GET /pos/catalog');
    expect(route.count).toBe(2);
    expect(route.p95).toBeGreaterThan(0);
  });

  it('names a route by its shape, not by the id it was called with', async () => {
    // Otherwise the map grows a row per product, every row holds one sample,
    // and nothing has a percentile worth reading.
    await api(fx.token, 'PATCH', `/pos/products/${fx.productId}`, {
      name: 'Вода 1 л', unit: 'шт', purchasePrice: 100, salePrice: 210, sellable: true,
    });

    const { body } = await metrics();
    expect(body.routes.some((r: any) => r.route === 'PATCH /pos/products/:id')).toBe(true);
    expect(body.routes.some((r: any) => r.route.includes(fx.productId))).toBe(false);
  });

  it('does not count a refused sale as a failure', async () => {
    // The single most important distinction here. A shop that sells out of
    // something all day is working correctly, and an error rate that says
    // otherwise is a figure everybody learns to ignore.
    const refused = await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 5000, price: 200 }],
    });
    expect(refused.status).toBe(409);

    const { body } = await metrics();
    const route = body.routes.find((r: any) => r.route === 'POST /pos/sales');
    expect(route.errors).toBe(0);
    expect(route.refusals).toBe(1);
    expect(body.verdict.healthy).toBe(true);
  });

  it('reports a healthy verdict for a server doing its job', async () => {
    await api(fx.token, 'GET', `/pos/catalog?locationId=${fx.locationId}`);
    const { body } = await metrics();
    expect(body.verdict.successRate).toBe(1);
    expect(body.verdict.healthy).toBe(true);
    expect(body.verdict.p95).toBeGreaterThanOrEqual(0);
  });

  it('counts a request that was never authorised', async () => {
    // Metrics that cover only the requests which went well describe a server
    // nobody is running.
    await fetch(`${baseUrl}/pos/catalog`);
    const { body } = await metrics();
    const route = body.routes.find((r: any) => r.route === 'GET /pos/catalog');
    expect(route.count).toBe(1);
    expect(route.refusals).toBe(1);
  });

  it('says how long it has been up, so a figure can be read in proportion', async () => {
    const { body } = await metrics();
    expect(typeof body.since).toBe('string');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('who may read the figures', () => {
  it('is not found without the secret', async () => {
    // 404 rather than 403: an endpoint that answers "wrong secret" has already
    // confirmed it exists, and latency per route is a map of where to push.
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(404);
  });

  it('is not found with the wrong secret', async () => {
    const res = await fetch(`${baseUrl}/metrics`, { headers: { 'x-maintenance-secret': 'guess' } });
    expect(res.status).toBe(404);
  });

  it('is not reachable with a cashier’s token', async () => {
    const res = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: `Bearer ${fx.token}` } });
    expect(res.status).toBe(404);
  });
});
