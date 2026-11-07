import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/protocol/types.ts'], reporter: ['text', 'json-summary'] },
  },
});
