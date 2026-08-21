import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Load .env.test before tests
    setupFiles: ['./src/__tests__/setup.ts'],
    // Separate unit and integration test projects
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.unit.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          // Integration tests run sequentially (DB)
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['src/**/*.e2e.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'coverage/', 'src/__tests__/'],
      // ─── Coverage thresholds ────────────────────────────────────────
      // These were previously 70/70/60 and NOTHING enforced them: `npm test`
      // did not pass --coverage, so the numbers were aspirational. Measured
      // for the first time on 2026-08-19, the unit suite alone produces
      // ~17% lines / ~64% functions / ~74% branches.
      //
      // Lines is low for a structural reason, not a laziness one: unit tests
      // mock the repositories, so repository and controller files are imported
      // (for their types) but never executed, and they are most of the line
      // count. Repositories are covered by the integration/e2e projects, which
      // need a live database — CI runs those, a local `npm run test:unit` does
      // not.
      //
      // So these are set as a RATCHET just under the current measured values:
      // their job is to fail when coverage REGRESSES, not to assert a quality
      // level nobody has met. Raise them as coverage genuinely rises; do not
      // raise them aspirationally, or this becomes decoration again.
      thresholds: {
        lines: 15,
        statements: 15,
        functions: 60,
        branches: 60,
      },
    },
  },
});
