#!/usr/bin/env node
/**
 * Connecting a customer, walked end to end against a running server.
 *
 * The question this answers is the one nobody wants to find the answer to with
 * a shop owner watching: on a deployment set up an hour ago, does the whole path
 * actually work? Platform account, company, location, tariff, a person with a
 * PIN, the till logging in, a product, opening stock, a shift, a sale, the
 * owner's summary, and the ledger agreeing with the shelf.
 *
 * The integration suite proves the code. This proves *this* server: its
 * migrations ran, its JWT secret is set, its database is the one you think it
 * is, and nothing in the chain falls over on a company four minutes old — a
 * state no other test covers, because every other test starts from a fixture.
 *
 *   API=https://api... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run onboard:check
 *
 * It creates a company and cannot delete it: there are no delete routes, by
 * design, because a company with documents against it must not be removable. So
 * it refuses to run when any company already exists. Run it on a fresh
 * deployment before the real customer goes in, or against a scratch database.
 */

const BASE = (process.env.API || 'http://localhost:4000').replace(/[/]+$/, '');
const EMAIL = process.env.ADMIN_EMAIL || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';

let token = null;
const steps = [];

async function call(method, path, body, useToken = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function step(name, ok, detail) {
  steps.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
  return ok;
}

const run = async () => {
  if (!EMAIL || !PASSWORD) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD — the platform account to sign in as.');
    process.exitCode = 2;
    return;
  }

  console.log(`\n== ${BASE} ==`);
  console.log('\n== the platform account ==');
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, false);
  if (!step('admin logs in', login.status === 200, JSON.stringify(login.data).slice(0, 200))) return;
  token = login.data.token;

  const existing = await call('GET', '/companies');
  const companies = Array.isArray(existing.data) ? existing.data : existing.data?.companies ?? [];
  if (companies.length > 0) {
    // Refused rather than carried on. This writes a company it cannot remove,
    // and a server that already has one is a server somebody is using.
    console.error(
      [
        '',
        `Refusing to run: ${BASE} already has ${companies.length} company(ies).`,
        'This check creates one and cannot delete it — there are no delete routes, because a',
        'company with documents against it must not be removable. Run it on a fresh deployment',
        'before the real customer is created, or against a scratch database.',
      ].join('\n'),
    );
    process.exitCode = 2;
    return;
  }
  step('and sees no companies yet', true);

  console.log('\n== the customer ==');
  const year = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const created = await call('POST', '/companies', {
    name: 'ПРОВЕРКА ПОДКЛЮЧЕНИЯ — удалить перед запуском',
    phone: '+7 701 000 00 00',
    location: { name: 'Проверочная точка', type: 'shop', address: '' },
    owner: { name: 'Проверочный владелец', phone: '' },
    tariff: { modules: ['shop', 'warehouse', 'retail', 'terminal'], supportLevel: 'basic', validUntil: year },
  });
  if (!step('company created', created.status === 201 || created.status === 200, `${created.status} ${JSON.stringify(created.data).slice(0, 300)}`)) return;
  const companyId = created.data.id ?? created.data.company?.id;
  step('and has an id', !!companyId, JSON.stringify(created.data).slice(0, 200));
  if (!companyId) return;

  // There is no GET /companies/:id — the admin panel reads the list, which
  // includes locations and the tariff. Worth knowing: a per-company endpoint is
  // what somebody would reach for first.
  const all = await call('GET', '/companies');
  const detail = (Array.isArray(all.data) ? all.data : all.data?.companies ?? []).find((c) => c.id === companyId);
  const locations = detail?.locations ?? [];
  step('with the location it was given', locations.length >= 1, JSON.stringify(detail).slice(0, 300));
  const tariff = detail?.tariff;
  step('and a tariff that is active', !!tariff, JSON.stringify(detail?.tariff ?? null).slice(0, 200));

  console.log('\n== the people ==');
  const cashier = await call('POST', `/companies/${companyId}/users`, {
    // Random, because a PIN is unique across the whole platform: a fixed one
    // would collide the second time this is ever run anywhere.
    name: 'Проверочный менеджер', role: 'manager', posPin: String(900000 + Math.floor(Math.random() * 99999)),
  });
  if (!step('manager created with a PIN', cashier.status === 201, `${cashier.status} ${JSON.stringify(cashier.data).slice(0, 200)}`)) return;

  const pin = cashier.data.posPin;
  const clash = await call('POST', `/companies/${companyId}/users`, { name: 'Второй', role: 'cashier', posPin: pin });
  step('a duplicate PIN is refused', clash.status === 409, `${clash.status} ${JSON.stringify(clash.data).slice(0, 120)}`);

  console.log('\n== the till ==');
  const pos = await call('POST', '/pos/login', { pin, deviceKey: 'aaaa1111-bbbb-4ccc-8ddd-eeee22223333' }, false);
  if (!step('the register logs in', pos.status === 200, `${pos.status} ${JSON.stringify(pos.data).slice(0, 300)}`)) return;
  const posToken = pos.data.token;
  step('and is told which location its stock belongs to', !!pos.data.catalogLocationId, JSON.stringify(pos.data.catalogLocationId));
  step('with an empty catalogue, not an error', Array.isArray(pos.data.products) && pos.data.products.length === 0,
    `products=${JSON.stringify(pos.data.products).slice(0, 120)}`);

  const locationId = pos.data.catalogLocationId;

  console.log('\n== the catalogue ==');
  const product = await fetch(`${BASE}/pos/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${posToken}` },
    body: JSON.stringify({ name: 'Хлеб', unit: 'шт', purchasePrice: 180, salePrice: 280, sellable: true, category: 'Хлеб' }),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  if (!step('a product can be added from the till', product.status === 201 || product.status === 200,
    `${product.status} ${JSON.stringify(product.data).slice(0, 200)}`)) return;
  const productId = product.data.id;

  console.log('\n== opening stock ==');
  const receipt = await fetch(`${BASE}/pos/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${posToken}`, 'Idempotency-Key': 'onboard-receipt-1' },
    body: JSON.stringify({ locationId, items: [{ productId, quantity: 40, price: 180 }] }),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  step('opening stock received', receipt.status === 201 || receipt.status === 200,
    `${receipt.status} ${JSON.stringify(receipt.data).slice(0, 250)}`);

  console.log('\n== a shift and a sale ==');
  const shift = await fetch(`${BASE}/pos/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${posToken}` },
    body: JSON.stringify({ locationId, openingCash: 5000, clientShiftId: 'onboard-shift-1' }),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  if (!step('shift opens', shift.status === 201 || shift.status === 200, `${shift.status} ${JSON.stringify(shift.data).slice(0, 250)}`)) return;

  const sale = await fetch(`${BASE}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${posToken}`, 'Idempotency-Key': 'onboard-sale-1' },
    body: JSON.stringify({
      locationId,
      paymentMethod: 'cash',
      clientShiftId: 'onboard-shift-1',
      items: [{ productId, quantity: 2, price: 280 }],
    }),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  step('a sale goes through', sale.status === 201 || sale.status === 200, `${sale.status} ${JSON.stringify(sale.data).slice(0, 250)}`);

  console.log('\n== the owner can see it ==');
  const dash = await fetch(`${BASE}/pos/dashboard?locationId=${locationId}&days=7`, {
    headers: { Authorization: `Bearer ${posToken}` },
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  step('the summary renders on a one-day-old shop', dash.status === 200, `${dash.status} ${JSON.stringify(dash.data).slice(0, 200)}`);
  if (dash.status === 200) {
    console.log(`  ..   revenue=${dash.data.money?.netRevenue} margin=${dash.data.money?.grossMargin}`);
  }

  const rec = await fetch(`${BASE}/pos/reconciliation?locationId=${locationId}`, {
    headers: { Authorization: `Bearer ${posToken}` },
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  step('stock equals the ledger', rec.status === 200 && rec.data?.mismatched === 0,
    `${rec.status} mismatched=${rec.data?.mismatched}`);
};

let crashed = null;

/**
 * What happened, and an exit code that agrees with it.
 *
 * `run` gives up early in several places — no credentials, a server already in
 * use, a step that makes the rest meaningless — and every one of those used to
 * fall through to "all 1 steps passed" with exit 0. A refusal that reports
 * success is worse than no check at all, which is a lesson this repository has
 * now learned twice: the post-deploy smoke script had the same shape.
 */
function summarise() {
  const failed = steps.filter((s) => !s.ok);
  console.log('\n== summary ==');

  if (crashed) {
    console.log(`  did not finish: ${crashed instanceof Error ? crashed.message : crashed}`);
    console.log(`  ${steps.length} step(s) ran before it stopped`);
    return;
  }
  // process.exitCode is already 2 when run() refused before doing any work.
  if (process.exitCode) {
    console.log('  nothing was attempted — see the reason above');
    return;
  }
  if (failed.length > 0) {
    console.log(`  ${failed.length} of ${steps.length} failed:`);
    failed.forEach((s) => console.log(`    - ${s.name}`));
    process.exitCode = 1;
    return;
  }
  console.log(`  all ${steps.length} steps passed`);
  console.log('  Remove the check company from the admin panel before the real one goes in.');
}

run()
  .catch((err) => {
    crashed = err;
    console.error('\nwalk threw:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(summarise);
