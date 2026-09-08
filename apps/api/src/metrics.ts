/**
 * How the server is actually behaving, in the two terms the charter is written
 * in: the share of operations that sync successfully, and p95 latency.
 *
 * Both were unmeasurable, which meant the pilot could be declared a success or
 * a failure on the strength of how the week felt. An average would not fix
 * that: a route that answers in 40 ms for ninety-nine customers and 9 seconds
 * for the hundredth averages 130 ms and reads as healthy, while the shop
 * remembers the queue. The hundredth customer is the number worth keeping.
 *
 * Kept in memory on purpose, at this stage. A metrics store is another thing
 * to run, to back up and to have fall over at four in the afternoon, and for
 * one pilot shop the questions being asked — is it slow, is anything failing —
 * are answered by the last few thousand requests. When there are dozens of
 * shops this becomes a real time-series database, and the shape of what is
 * recorded here is what would be shipped to it.
 */

/**
 * How many samples a route keeps.
 *
 * Bounded because a server that runs for a month must not grow a list per
 * route until it falls over — an observability feature that takes the shop
 * down has done more harm than the blindness it cured. Two thousand covers a
 * busy shop's morning, which is the window anybody actually asks about.
 */
export const SAMPLE_LIMIT = 2000;

export interface RouteSamples {
  /** Durations in milliseconds, oldest first, capped at SAMPLE_LIMIT. */
  durations: number[];
  count: number;
  /** 5xx, and anything that threw. A 4xx is the server working correctly. */
  errors: number;
  /** 4xx, kept apart: a refused sale is not an outage. */
  refusals: number;
  lastAt: number;
}

export interface RouteSummary {
  route: string;
  count: number;
  errors: number;
  refusals: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function emptySamples(): RouteSamples {
  return { durations: [], count: 0, errors: 0, refusals: 0, lastAt: 0 };
}

/**
 * Records one request.
 *
 * A 4xx is counted apart from a 5xx, and that distinction is the whole point
 * of the error rate. "Not enough stock" and "this key was already used" are
 * the server doing its job; folding them into the same number as a crash would
 * make a busy, correct shop look like a failing one and teach everybody to
 * ignore the figure.
 */
export function record(samples: RouteSamples, durationMs: number, status: number, now = Date.now()): RouteSamples {
  const durations = samples.durations.length >= SAMPLE_LIMIT
    ? [...samples.durations.slice(1), durationMs]
    : [...samples.durations, durationMs];

  return {
    durations,
    count: samples.count + 1,
    errors: samples.errors + (status >= 500 ? 1 : 0),
    refusals: samples.refusals + (status >= 400 && status < 500 ? 1 : 0),
    lastAt: now,
  };
}

/**
 * The value below which the given share of requests fell.
 *
 * Nearest-rank rather than interpolated: with a few hundred samples the
 * interpolated figure is a number no request actually took, and a latency
 * report is more useful when every number in it happened.
 */
export function percentile(sorted: number[], share: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(share * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summarise(route: string, samples: RouteSamples): RouteSummary {
  const sorted = [...samples.durations].sort((a, b) => a - b);
  return {
    route,
    count: samples.count,
    errors: samples.errors,
    refusals: samples.refusals,
    // Against everything served, so it answers "what share of requests failed".
    errorRate: samples.count === 0 ? 0 : samples.errors / samples.count,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

export interface HealthVerdict {
  /** The charter's number: successful operations as a share of all of them. */
  successRate: number;
  p95: number;
  /** True when both charter targets are met. */
  healthy: boolean;
  /** Routes missing a target, worst first — where to look, not just that to look. */
  worst: RouteSummary[];
}

/** From the charter: «успешная синхронизация операций ≥ 99.9%». */
export const SUCCESS_RATE_TARGET = 0.999;
/** From the readiness contract: p95 < 500 ms. */
export const P95_TARGET_MS = 500;

/**
 * The two charter numbers, and where they are being missed.
 *
 * Takes the samples rather than the summaries, because the overall p95 has to
 * come from every request pooled together. Taking the worst route's p95
 * instead would let one rarely-used slow report fail the whole verdict while
 * every customer at the counter was served in 40 ms.
 *
 * A verdict that says only "unhealthy" sends somebody to read logs. Naming the
 * routes turns the same information into the next thing to do.
 */
export function judge(entries: { route: string; samples: RouteSamples }[]): HealthVerdict {
  const summaries = entries.map((entry) => summarise(entry.route, entry.samples));
  const count = summaries.reduce((sum, s) => sum + s.count, 0);
  const errors = summaries.reduce((sum, s) => sum + s.errors, 0);

  // Across everything, not the average of per-route rates: a rarely-used route
  // failing twice would otherwise drag the whole figure down as hard as the
  // sale route failing twice, and they are not the same event.
  const successRate = count === 0 ? 1 : (count - errors) / count;

  const pooled = entries.flatMap((entry) => entry.samples.durations).sort((a, b) => a - b);
  const p95 = percentile(pooled, 0.95);

  const worst = summaries
    .filter((s) => s.count > 0 && (s.errors > 0 || s.p95 >= P95_TARGET_MS))
    .sort((a, b) => (b.errorRate - a.errorRate) || (b.p95 - a.p95))
    .slice(0, 10);

  return {
    successRate,
    p95,
    healthy: successRate >= SUCCESS_RATE_TARGET && p95 < P95_TARGET_MS,
    worst,
  };
}

/**
 * The route as it is written, not as it was called.
 *
 * `/pos/products/:id`, never `/pos/products/cmts…`. Without this the map grows
 * a row per product and every row holds one sample, so nothing has a
 * percentile and the memory bound protects nothing.
 */
export function routeKey(method: string, path: string): string {
  const normalised = path
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      // cuid, uuid, or any long opaque token: an id, whatever its shape.
      if (/^c[a-z0-9]{20,}$/i.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ':id';
      if (/^\d+$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
  return `${method} ${normalised}`;
}
