import { describe, it, expect } from 'vitest';
import {
  emptySamples,
  judge,
  P95_TARGET_MS,
  percentile,
  record,
  routeKey,
  SAMPLE_LIMIT,
  summarise,
} from './metrics';
import type { RouteSamples } from './metrics';

function withDurations(durations: number[], over: Partial<RouteSamples> = {}): RouteSamples {
  return { ...emptySamples(), durations, count: durations.length, ...over };
}

describe('recording a request', () => {
  it('keeps the duration and counts the request', () => {
    const samples = record(emptySamples(), 42, 200);
    expect(samples.durations).toEqual([42]);
    expect(samples.count).toBe(1);
    expect(samples.errors).toBe(0);
  });

  it('counts a 5xx as an error', () => {
    expect(record(emptySamples(), 42, 500).errors).toBe(1);
  });

  it('does not count a refused sale as an error', () => {
    // "Not enough stock" and "this key was already used" are the server doing
    // its job. Folding them in with crashes would make a busy, correct shop
    // look like a failing one, and teach everybody to ignore the figure.
    const samples = record(record(emptySamples(), 12, 409), 8, 400);
    expect(samples.errors).toBe(0);
    expect(samples.refusals).toBe(2);
  });

  it('forgets the oldest sample rather than growing without bound', () => {
    // An observability feature that takes the shop down at four in the
    // afternoon has done more harm than the blindness it cured.
    let samples = withDurations(Array.from({ length: SAMPLE_LIMIT }, (_, i) => i));
    samples = record(samples, 9999, 200);
    expect(samples.durations).toHaveLength(SAMPLE_LIMIT);
    expect(samples.durations[SAMPLE_LIMIT - 1]).toBe(9999);
    expect(samples.durations[0]).toBe(1);
  });

  it('keeps counting past the sample limit', () => {
    // The window is bounded; the totals are not, or an hour of traffic would
    // report as two thousand requests forever.
    const samples = record(withDurations(Array(SAMPLE_LIMIT).fill(1), { count: 50_000 }), 5, 200);
    expect(samples.count).toBe(50_001);
  });

  it('does not change the samples it was given', () => {
    const before = emptySamples();
    record(before, 42, 200);
    expect(before.durations).toEqual([]);
  });
});

describe('percentile', () => {
  it('takes a value that actually happened, not one between two', () => {
    // A latency report is more useful when every number in it is a request
    // somebody really waited for.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });

  it('is zero when nothing has been served', () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it('handles a single sample', () => {
    expect(percentile([7], 0.99)).toBe(7);
  });
});

describe('summarising a route', () => {
  it('reports the slow tail, not the comfortable average', () => {
    // Ninety-nine at 40 ms and one at 9 seconds averages 130 ms and reads as
    // healthy, while the shop remembers the queue.
    const durations = [...Array(99).fill(40), 9000];
    const summary = summarise('POST /pos/sales', withDurations(durations));
    expect(summary.p50).toBe(40);
    expect(summary.p99).toBe(40);
    expect(summary.max).toBe(9000);
  });

  it('reports the error rate against everything served', () => {
    const summary = summarise('POST /pos/sales', withDurations([1, 2, 3, 4], { count: 4, errors: 1 }));
    expect(summary.errorRate).toBe(0.25);
  });

  it('reports nothing rather than dividing by zero on an untouched route', () => {
    const summary = summarise('GET /pos/reports', emptySamples());
    expect(summary).toMatchObject({ count: 0, errorRate: 0, p95: 0, max: 0 });
  });
});

describe('the charter’s two numbers', () => {
  const fast = (route: string, n: number, errors = 0) => ({
    route,
    samples: withDurations(Array(n).fill(40), { count: n, errors }),
  });

  it('calls a fast, clean server healthy', () => {
    const verdict = judge([fast('POST /pos/sales', 1000)]);
    expect(verdict.successRate).toBe(1);
    expect(verdict.p95).toBe(40);
    expect(verdict.healthy).toBe(true);
  });

  it('fails the verdict when more than one request in a thousand errors', () => {
    // The charter's own figure: «успешная синхронизация операций ≥ 99.9%».
    const verdict = judge([fast('POST /pos/sales', 1000, 2)]);
    expect(verdict.successRate).toBeCloseTo(0.998, 5);
    expect(verdict.healthy).toBe(false);
  });

  it('fails the verdict when the tail crosses half a second', () => {
    const slow = { route: 'GET /pos/reports', samples: withDurations(Array(100).fill(P95_TARGET_MS + 1), { count: 100 }) };
    expect(judge([slow]).healthy).toBe(false);
  });

  it('pools every request for the overall tail rather than taking the worst route', () => {
    // One rarely-used slow report must not fail the verdict while every
    // customer at the counter is served in 40 ms.
    const verdict = judge([
      fast('POST /pos/sales', 1000),
      { route: 'GET /pos/reports', samples: withDurations([4000, 4200], { count: 2 }) },
    ]);
    expect(verdict.p95).toBe(40);
    expect(verdict.healthy).toBe(true);
  });

  it('still names the slow route even when the verdict passes', () => {
    // Where to look, not merely that something is worth looking at.
    const verdict = judge([
      fast('POST /pos/sales', 1000),
      { route: 'GET /pos/reports', samples: withDurations([4000, 4200], { count: 2 }) },
    ]);
    expect(verdict.worst.map((s) => s.route)).toEqual(['GET /pos/reports']);
  });

  it('weighs a rare route’s failures by how rare it is', () => {
    // Two failures on a route called twice is not the same event as two on the
    // route every sale goes through, and averaging per-route rates would say
    // it was.
    const verdict = judge([
      fast('POST /pos/sales', 10_000),
      { route: 'GET /pos/audit', samples: withDurations([10, 10], { count: 2, errors: 2 }) },
    ]);
    expect(verdict.successRate).toBeGreaterThan(0.999);
    expect(verdict.healthy).toBe(true);
    expect(verdict.worst[0].route).toBe('GET /pos/audit');
  });

  it('calls a server that has served nothing healthy rather than broken', () => {
    // A shop that has not opened yet is not failing.
    expect(judge([])).toMatchObject({ successRate: 1, p95: 0, healthy: true });
  });
});

describe('naming a route', () => {
  it('uses the route as written, not as called', () => {
    // Without this the map grows a row per product, every row holds one
    // sample, nothing has a percentile, and the memory bound protects nothing.
    expect(routeKey('PATCH', '/pos/products/cmts2i5ds003xhhgcjaju1rxr')).toBe('PATCH /pos/products/:id');
  });

  it('recognises a uuid as an id too', () => {
    expect(routeKey('GET', '/pos/orders/6f616b42-0ed8-571e-823f-ee4aca6b7ce9')).toBe('GET /pos/orders/:id');
  });

  it('recognises a numeric id', () => {
    expect(routeKey('GET', '/pos/orders/42')).toBe('GET /pos/orders/:id');
  });

  it('leaves real path segments alone', () => {
    // Including the ones that look like words but are actions.
    expect(routeKey('POST', '/pos/counts/by-bin')).toBe('POST /pos/counts/by-bin');
    expect(routeKey('POST', '/pos/quarantine/block')).toBe('POST /pos/quarantine/block');
  });

  it('keeps two ids in one path apart from the words around them', () => {
    expect(routeKey('POST', '/pos/transfers/cmts2i5ds003xhhgcjaju1rxr/receive'))
      .toBe('POST /pos/transfers/:id/receive');
  });
});
