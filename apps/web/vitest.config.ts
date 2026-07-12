import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true, // enables @testing-library/react auto-cleanup
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
