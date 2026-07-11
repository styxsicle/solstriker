import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read env (VITE_API_BASE_URL) from the repo root .env.
  // Only VITE_-prefixed variables are ever exposed to the client.
  envDir: '../..',
  server: { port: 5173 },
});
