import { defineConfig } from '@playwright/test';

// Visual baselines of every page. Own port so it never collides with a running `npm run dev` (5173).
const PORT = 5191;

export default defineConfig({
  testDir: 'visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  use: { baseURL: `http://localhost:${PORT}`, colorScheme: 'dark', locale: 'en-GB', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  ],
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 60_000 },
});
