import { defineConfig } from 'vitest/config';

// Separate from the unit config on purpose. `npm test` must stay fast and
// need nothing installed, so it can run on any machine and in any hook;
// these need a Postgres and take seconds rather than milliseconds.
//
// Single-threaded and sequential: every case truncates the whole database, so
// two running at once would clear each other's fixtures. The cost of that is a
// slower suite; the cost of not doing it is a suite that fails at random,
// which is worse than no suite because people learn to re-run it.
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
