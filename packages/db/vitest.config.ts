import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // RLS tests need time to set up fixtures
    hookTimeout: 30000,
    teardownTimeout: 30000
  }
});
