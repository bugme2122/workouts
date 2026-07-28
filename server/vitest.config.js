import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // DB-backed integration tests share a single in-memory Mongo; run serially.
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 30000,
    include: ['tests/**/*.test.js'],
  },
});
