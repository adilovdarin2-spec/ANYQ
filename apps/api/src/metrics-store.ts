import type { NextFunction, Request, Response } from 'express';
import { emptySamples, judge, record, routeKey, summarise } from './metrics';
import type { HealthVerdict, RouteSamples, RouteSummary } from './metrics';

/**
 * The live figures, and the middleware that fills them.
 *
 * Separate from metrics.ts so the arithmetic stays pure and testable while the
 * mutable state and the Express wiring live in one place that can be reset.
 */

const routes = new Map<string, RouteSamples>();
let startedAt = Date.now();

/**
 * How many routes are tracked at once.
 *
 * A second bound behind routeKey's normalisation. If a path shape ever slips
 * through unnormalised — a new route with an id format nobody anticipated —
 * this stops the map growing until the process dies. It should never be
 * reached; that is the point of having it.
 */
const MAX_ROUTES = 200;

export function observe(route: string, durationMs: number, status: number): void {
  const existing = routes.get(route);
  if (!existing && routes.size >= MAX_ROUTES) return;
  routes.set(route, record(existing ?? emptySamples(), durationMs, status));
}

/**
 * Times every request, including the ones that throw.
 *
 * Hooked on the response finishing rather than wrapping the handler: a request
 * that fails partway still took time and still has a status, and leaving those
 * out would make an unhealthy server look fast.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedHr = process.hrtime.bigint();

  // Resolved now, not when the response finishes. Express rewrites req.url and
  // req.path as it dispatches into a mounted router, so reading them later
  // gives the path with the mount prefix already stripped — every POS route
  // would be recorded without its /pos, and two routers' identically-named
  // endpoints would share a row. originalUrl is never rewritten.
  const path = req.originalUrl.split('?')[0];
  const route = routeKey(req.method, path);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedHr) / 1_000_000;
    observe(route, durationMs, res.statusCode);
  });
  next();
}

export interface MetricsReport {
  since: string;
  uptimeSeconds: number;
  verdict: HealthVerdict;
  routes: RouteSummary[];
}

export function report(): MetricsReport {
  const entries = [...routes.entries()].map(([route, samples]) => ({ route, samples }));
  return {
    since: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    verdict: judge(entries),
    routes: entries
      .map((entry) => summarise(entry.route, entry.samples))
      .sort((a, b) => b.count - a.count),
  };
}

/** For tests, and for a deliberate reset after a deploy. */
export function resetMetrics(): void {
  routes.clear();
  startedAt = Date.now();
}
