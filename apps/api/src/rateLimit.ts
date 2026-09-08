import rateLimit from 'express-rate-limit';
import { MemoryStore } from 'express-rate-limit';

// Held so the integration suite can clear them between cases. The suite logs
// in dozens of times from one address, which a limit tuned for a real login
// page correctly refuses — and lowering the real limit to make tests pass
// would be tuning security to suit the test runner.
const loginStore = new MemoryStore();
const writeStore = new MemoryStore();

/** Test-only. Never called from a route. */
export function resetRateLimits(): void {
  loginStore.resetAll?.();
  writeStore.resetAll?.();
}

// Login is guessed at; everything else is hammered by a stuck client, a retry
// loop, or somebody probing. The two want very different ceilings, so they get
// two.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: loginStore,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа — попробуйте позже' },
});

// Generous on purpose: a busy register legitimately fires several requests a
// second during a rush, and a limit that stops a real shop is worse than no
// limit at all. This is a ceiling on runaway clients and crude probing, not a
// business rule — and it is per IP, so one shop's till cannot exhaust another's
// allowance.
export const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  store: writeStore,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов — подождите немного' },
});
