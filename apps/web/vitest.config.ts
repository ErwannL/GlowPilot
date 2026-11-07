import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/main.tsx', 'src/**/*.d.ts'], reporter: ['text', 'json-summary'] },
  },
});
