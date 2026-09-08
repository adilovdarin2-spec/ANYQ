// One shop's working day, against a server that is actually running.
//
// This was written when nothing else touched the database, and it said so: the
// tests were pure functions, and no line of database code had ever executed.
// That is no longer true — the integration suite resets between cases and
// covers the routes properly — so this is not the safety net any more.
//
// What it is now is the check to run after a deployment. The integration suite
// proves the code; this proves *this* server: its migrations ran, its
// connection string points where it should, its environment is complete, and a
// sale placed through the front door comes out the far side with the ledger
// still balancing. No unit test can fail on a half-migrated production
// database, and that is the failure worth catching on the day you deploy.
//
// It walks a shop through a day — sell, replay the same sale, return, receive,
// transfer and receive short, put away, count a shelf, write off, order and
// part-receive — and finishes on the invariant everything else rests on: stock
// equals the sum of its own movements, per shelf.
//
//   npm run smoke                     # against http://localhost:4010
//   API=https://api.example npm run smoke
//
// It writes real data and does not clean up after itself. That is the point on
// a fresh deployment and unacceptable on a live one: point it at a new or
// development database, never at a shop's.

const BASE = process.env.API || 'http://localhost:4010';

let token = null;
const failures = [];
const notes = [];
// Checks that could not be run here, as opposed to checks that passed. A run
// that skipped one has not proved everything, and saying "all checks passed"
// is the difference between a deployment somebody verified and one somebody
// watched go green.
const skipped = [];

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  OK   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function note(text) {
  notes.push(text);
  console.log(`  ..   ${text}`);
}

function skip(name, why) {
  skipped.push(name);
  console.log(`  SKIP ${name} — ${why}`);
}

const run = async () => {
  console.log('\n== login ==');
  const login = await call('POST', '/pos/login', { pin: '4444' });
  check('POS login', login.status === 200, JSON.stringify(login.data).slice(0, 200));
  if (login.status !== 200) return;
  token = login.data.token;
  const locations = login.data.locations;
  const products = login.data.products;
  note(`company=${login.data.company.name} locations=${locations.length} products=${products.length} catalogLocation=${login.data.catalogLocationId}`);
  check('login names the catalog location', !!login.data.catalogLocationId);

  const locationId = login.data.catalogLocationId;
  const sellable = products.find((p) => p.stock > 5 && p.saleUnit === 'piece' && p.variants.length === 0 && p.modifiers.length === 0);
  check('a sellable product with stock exists', !!sellable, sellable ? '' : 'none found');
  if (!sellable) return;
  note(`product "${sellable.name}" stock=${sellable.stock} price=${sellable.price}`);

  console.log('\n== catalog for another location ==');
  const other = locations.find((l) => l.id !== locationId);
  if (other) {
    const cat = await call('GET', `/pos/catalog?locationId=${other.id}`);
    check('catalog loads for a second location', cat.status === 200, JSON.stringify(cat.data).slice(0, 200));
  } else {
    note('single-location company — nothing to switch to');
  }

  console.log('\n== shift ==');
  const shift = await call('POST', '/pos/shifts', { locationId, openingCash: 20000 });
  check('open shift', shift.status === 201, JSON.stringify(shift.data).slice(0, 200));

  console.log('\n== sale, and the same sale again ==');
  const saleBody = {
    locationId,
    paymentMethod: 'cash',
    items: [{ productId: sellable.id, quantity: 2, price: sellable.price }],
  };
  const key = `smoke_${Date.now()}`;
  const first = await call('POST', '/pos/sales', saleBody, { 'Idempotency-Key': key });
  check('sale accepted', first.status === 201, JSON.stringify(first.data).slice(0, 300));
  const replay = await call('POST', '/pos/sales', saleBody, { 'Idempotency-Key': key });
  check('replay returns the same receipt, not a second sale',
    replay.status === 201 && replay.data?.id === first.data?.id,
    `first=${first.data?.id} replay=${replay.data?.id} status=${replay.status}`);

  console.log('\n== stock moved exactly once ==');
  const after = await call('GET', `/pos/catalog?locationId=${locationId}`);
  const afterProduct = after.data?.products?.find((p) => p.id === sellable.id);
  check('stock fell by exactly one sale',
    afterProduct && afterProduct.stock === sellable.stock - 2,
    `before=${sellable.stock} after=${afterProduct?.stock} expected=${sellable.stock - 2}`);

  console.log('\n== duplicate cart lines ==');
  const dupKey = `smoke_dup_${Date.now()}`;
  const dup = await call('POST', '/pos/sales', {
    locationId,
    paymentMethod: 'cash',
    items: [
      { productId: sellable.id, quantity: 1, price: sellable.price },
      { productId: sellable.id, quantity: 1, price: sellable.price },
    ],
  }, { 'Idempotency-Key': dupKey });
  check('two lines of one product accepted', dup.status === 201, JSON.stringify(dup.data).slice(0, 200));
  const afterDup = await call('GET', `/pos/catalog?locationId=${locationId}`);
  const dupProduct = afterDup.data?.products?.find((p) => p.id === sellable.id);
  check('both lines were deducted, not one',
    dupProduct && dupProduct.stock === sellable.stock - 4,
    `expected=${sellable.stock - 4} actual=${dupProduct?.stock}`);

  console.log('\n== overselling ==');
  const overKey = `smoke_over_${Date.now()}`;
  const over = await call('POST', '/pos/sales', {
    locationId,
    paymentMethod: 'cash',
    items: [{ productId: sellable.id, quantity: 100000, price: sellable.price }],
  }, { 'Idempotency-Key': overKey });
  check('selling more than exists is refused', over.status === 409, `status=${over.status}`);

  console.log('\n== returns ==');
  const sales = await call('GET', `/pos/sales?locationId=${locationId}`);
  check('sales list loads', sales.status === 200, JSON.stringify(sales.data).slice(0, 200));
  const target = Array.isArray(sales.data) ? sales.data.find((s) => s.id === first.data?.id) : null;
  if (target) {
    const ret = await call('POST', '/pos/returns', {
      saleId: target.id,
      reason: 'дымовой тест',
      paymentMethod: 'cash',
      items: [{ documentItemId: target.items[0].id, quantity: 1 }],
    }, { 'Idempotency-Key': `smoke_ret_${Date.now()}` });
    check('return accepted', ret.status === 201, JSON.stringify(ret.data).slice(0, 300));
    check('refund is a number', typeof ret.data?.refundAmount === 'number', JSON.stringify(ret.data).slice(0, 200));
  } else {
    check('the sale appears in the returnable list', false, 'not found');
  }

  console.log('\n== receiving ==');
  const receipt = await call('POST', '/pos/receipts', {
    locationId,
    supplierName: 'Дымовой поставщик',
    supplierPhone: '',
    items: [{ productId: sellable.id, quantity: 10, price: 100, packagingId: null }],
  });
  check('receipt accepted', receipt.status === 201, JSON.stringify(receipt.data).slice(0, 300));

  console.log('\n== transfer in transit ==');
  if (other) {
    const transfer = await call('POST', '/pos/transfers', {
      fromLocationId: locationId,
      toLocationId: other.id,
      items: [{ productId: sellable.id, quantity: 3 }],
    });
    check('transfer created', transfer.status === 201, JSON.stringify(transfer.data).slice(0, 300));
    check('transfer starts in transit', transfer.data?.status === 'in_transit', `status=${transfer.data?.status}`);

    const destBefore = await call('GET', `/pos/catalog?locationId=${other.id}`);
    const destProduct = destBefore.data?.products?.find((p) => p.id === sellable.id);
    note(`destination stock while in transit: ${destProduct?.stock}`);

    const receive = await call('POST', `/pos/transfers/${transfer.data?.id}/receive`, {
      locationId: other.id,
      items: [{ productId: sellable.id, receivedQuantity: 2 }],
    });
    check('receiving a short delivery is accepted', receive.status === 200, JSON.stringify(receive.data).slice(0, 300));
    check('the shortfall is reported', receive.data?.hasShortfall === true, JSON.stringify(receive.data).slice(0, 200));
  } else {
    note('single location — transfers not exercised');
  }

  console.log('\n== bins ==');
  const binCode = `Z-${String(Date.now()).slice(-4)}`;
  const bin = await call('POST', '/pos/bins', { locationId, zone: 'Z', rack: String(Date.now()).slice(-4), shelf: '', bin: '' });
  check('bin created', bin.status === 201, JSON.stringify(bin.data).slice(0, 200));
  if (bin.status === 201) {
    const putaway = await call('POST', '/pos/bins/putaway', {
      locationId,
      productId: sellable.id,
      quantity: 2,
      fromBin: '',
      toBin: bin.data.code,
    });
    check('putaway moves goods to the shelf', putaway.status === 200, JSON.stringify(putaway.data).slice(0, 300));

    const sheet = await call('GET', `/pos/counts/sheet?locationId=${locationId}&bin=${encodeURIComponent(bin.data.code)}`);
    check('count sheet lists the shelf', sheet.status === 200 && sheet.data?.lines?.length > 0, JSON.stringify(sheet.data).slice(0, 200));

    const binCount = await call('POST', '/pos/counts/by-bin', {
      locationId,
      bins: [bin.data.code],
      items: [{ productId: sellable.id, binLocation: bin.data.code, countedQuantity: 1 }],
    });
    check('bin count accepted', binCount.status === 201, JSON.stringify(binCount.data).slice(0, 300));
    check('the missing unit is found', binCount.data?.adjustments?.some((a) => a.delta === -1), JSON.stringify(binCount.data?.adjustments).slice(0, 200));
  }

  console.log('\n== write-off and quarantine ==');
  const writeOff = await call('POST', '/pos/write-offs', {
    locationId,
    reasonCode: 'damage',
    note: 'дымовой тест',
    items: [{ productId: sellable.id, quantity: 1 }],
  });
  check('write-off accepted', writeOff.status === 201, JSON.stringify(writeOff.data).slice(0, 300));

  console.log('\n== replenishment and purchase orders ==');
  const repl = await call('GET', `/pos/replenishment?locationId=${locationId}`);
  check('replenishment computes', repl.status === 200, JSON.stringify(repl.data).slice(0, 200));
  note(`items to order: ${repl.data?.items?.length ?? '-'}`);

  const po = await call('POST', '/pos/purchase-orders', {
    locationId,
    supplierId: null,
    note: 'дымовой тест',
    items: [{ productId: sellable.id, quantity: 5, price: 100, packagingId: null }],
  });
  check('purchase order created as a draft', po.status === 201 && po.data?.status === 'draft', JSON.stringify(po.data).slice(0, 200));
  if (po.status === 201) {
    const badReceive = await call('POST', '/pos/receipts', {
      locationId,
      purchaseOrderId: po.data.id,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: sellable.id, quantity: 1, price: 100, packagingId: null }],
    });
    check('a draft order cannot be delivered against', badReceive.status === 409, `status=${badReceive.status}`);

    const approve = await call('POST', `/pos/purchase-orders/${po.data.id}/approve`);
    const send = await call('POST', `/pos/purchase-orders/${po.data.id}/send`);
    check('order approved and sent', approve.status === 200 && send.status === 200, `${approve.status}/${send.status}`);

    const partial = await call('POST', '/pos/receipts', {
      locationId,
      purchaseOrderId: po.data.id,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: sellable.id, quantity: 2, price: 100, packagingId: null }],
    });
    check('partial delivery accepted', partial.status === 201, JSON.stringify(partial.data).slice(0, 200));
    const orders = await call('GET', `/pos/purchase-orders?locationId=${locationId}`);
    const reloaded = Array.isArray(orders.data) ? orders.data.find((o) => o.id === po.data.id) : null;
    check('order is now partly received', reloaded?.status === 'partially_received', `status=${reloaded?.status}`);
  }

  console.log('\n== owner dashboard ==');
  const dash = await call('GET', `/pos/dashboard?locationId=${locationId}&days=7`);
  check('dashboard renders', dash.status === 200, JSON.stringify(dash.data).slice(0, 300));
  if (dash.status === 200) {
    note(`revenue=${dash.data.money.netRevenue} margin=${dash.data.money.grossMargin} flags=${dash.data.flags.length}`);
  }

  console.log('\n== the invariant ==');
  const rec = await call('GET', `/pos/reconciliation?locationId=${locationId}`);
  check('reconciliation runs', rec.status === 200, JSON.stringify(rec.data).slice(0, 300));
  check('stock equals the ledger, everywhere',
    rec.data?.mismatched === 0,
    `checked=${rec.data?.checked} mismatched=${rec.data?.mismatched} drift=${rec.data?.totalDrift} first=${JSON.stringify(rec.data?.mismatches?.[0] ?? null)}`);

  console.log('\n== revoking access ==');
  // Bumped straight in the database rather than through an endpoint. A route
  // that retires somebody else's token on request is a back door, and a test
  // hook shipped in production code is the same thing with a nicer name.
  if (!process.env.DATABASE_URL) {
    skip('a token minted before revocation stops working', 'set DATABASE_URL to include it');
  } else {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    try {
      await db.user.update({ where: { id: login.data.user.id }, data: { tokenVersion: { increment: 1 } } });
      const afterRevoke = await call('GET', `/pos/replenishment?locationId=${locationId}`);
      check('a token minted before revocation stops working', afterRevoke.status === 401, `status=${afterRevoke.status}`);
      // Put it back, so re-running the script does not need a fresh login.
      await db.user.update({ where: { id: login.data.user.id }, data: { tokenVersion: { decrement: 1 } } });
    } finally {
      await db.$disconnect();
    }
  }

};

/**
 * What happened, and the exit code that says so.
 *
 * Outside `run`, and called from a `finally`, because `run` gives up early when
 * there is no login and when there is nothing sellable — and a summary printed
 * at the bottom of `run` is a summary those two paths skip. That was the whole
 * failure: the server answers, login is broken, one FAIL is printed, and the
 * script exits 0. Anything reading the status — a deploy pipeline, a person's
 * `&&` — was told the deployment was fine.
 */
function summarise(crash) {
  console.log('\n== summary ==');
  if (crash) {
    // Said first and on its own. A run that stopped before its checks ran has
    // an empty failure list, and reporting that as "all checks passed" beside a
    // non-zero exit code is worse than saying nothing.
    console.log(`  run did not finish: ${crash instanceof Error ? crash.message : crash}`);
    console.log(`  ${failures.length} failed and ${skipped.length} skipped before it stopped`);
  } else if (failures.length > 0) {
    console.log(`  ${failures.length} failed:`);
    for (const failure of failures) console.log(`    - ${failure}`);
  } else if (skipped.length > 0) {
    console.log(`  checks passed, but ${skipped.length} could not be run:`);
    for (const name of skipped) console.log(`    - ${name}`);
  } else {
    console.log('  all checks passed');
  }
  if (failures.length > 0) process.exitCode = 1;
}

let crashed = null;
run()
  .catch((err) => {
    crashed = err;
    console.error('smoke run threw:', err);
    process.exitCode = 1;
  })
  .finally(() => summarise(crashed));
