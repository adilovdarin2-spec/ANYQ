import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `scripts/` тоже: общий статический сервер оттуда отдаёт кассу, админку
    // и витрину, и заголовки безопасности всех трёх стоят в нём одном.
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The database tests live behind their own config and their own command.
    // `npm test` has to stay fast and need nothing installed, so it can run in
    // a hook on any machine; those need a Postgres and take seconds.
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/api/src/integration/**'],
    environment: 'node',
  },
});
