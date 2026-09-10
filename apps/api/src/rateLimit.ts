import rateLimit from 'express-rate-limit';
import { MemoryStore } from 'express-rate-limit';

// Held so the integration suite can clear them between cases. The suite logs
// in dozens of times from one address, which a limit tuned for a real login
// page correctly refuses — and lowering the real limit to make tests pass
// would be tuning security to suit the test runner.
const loginStore = new MemoryStore();
const writeStore = new MemoryStore();
const cabinetProbeStore = new MemoryStore();

/** Test-only. Never called from a route. */
export function resetRateLimits(): void {
  loginStore.resetAll?.();
  writeStore.resetAll?.();
  cabinetProbeStore.resetAll?.();
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

/**
 * Открытие ссылки на кабинет — это не попытка входа.
 *
 * Сначала эта страница висела на `loginRateLimit`, и получалось вот что:
 * страница спрашивает состояние ссылки при каждой загрузке, а лимит входа —
 * десять попыток за четверть часа. Владелец, десять раз обновивший свой
 * кабинет утром, запирал сам себя, и сообщение говорило ему «слишком много
 * попыток входа», хотя он не вводил ничего.
 *
 * Лимит всё равно нужен: маршрут отвечает по секрету из ссылки и без пароля,
 * то есть годится для перебора. Но перебирать 128 бит бессмысленно при любом
 * потолке, а вот запирать владельца — вполне реально при низком. Отсюда
 * шестьдесят: перебору это не помогает, живому человеку не мешает.
 */
export const cabinetProbeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  store: cabinetProbeStore,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много обращений — подождите немного' },
});
