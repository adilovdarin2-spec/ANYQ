import { defineConfig } from 'vitest/config';

// Separate from the unit config on purpose. `npm test` must stay fast and
// need nothing installed, so it can run on any machine and in any hook;
// these need a Postgres and take seconds rather than milliseconds.
//
// Single-threaded and sequential: every case truncates the whole database, so
// two running at once would clear each other's fixtures. The cost of that is a
// slower suite; the cost of not doing it is a suite that fails at random,
// which is worse than no suite because people learn to re-run it.
// Pointed at the test database here rather than left to whoever types the
// command. `apps/api/.env` names the development database — the one with the
// developer's own data in it — so a plain `npm run test:db` used to truncate
// exactly what somebody was looking at. A documented incantation that has to be
// typed correctly every time is not a safeguard; a default that is right is.
//
// An explicit DATABASE_URL still wins, for CI and for pointing the suite
// somewhere else on purpose.
const TEST_DATABASE_URL = 'postgresql://anyq:anyq_dev@localhost:5433/anyq_test?schema=public';
process.env.DATABASE_URL = process.env.DATABASE_URL || TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-tests-only';

export default defineConfig({
  test: {
    include: ['apps/api/src/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
