import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
    // Tests share one SQLite file; run files sequentially.
    fileParallelism: false,
  },
});
