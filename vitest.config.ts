import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/core/src/**/*.spec.ts',
      'packages/*/*/src/**/*.spec.ts',
      'packages/*/*/*/src/**/*.spec.ts',
      'tests/**/*.spec.ts',
      'tests/**/*.spec.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'packages/core/src/**/*.ts',
        'packages/*/*/src/**/*.ts',
        'packages/*/*/*/src/**/*.ts',
      ],
      exclude: ['**/*.spec.ts', '**/dist/**'],
    },
  },
});
