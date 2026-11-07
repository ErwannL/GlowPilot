import { expect, test, type Page } from '@playwright/test';

const PAGES = ['home', 'color', 'effects', 'scenes', 'automation', 'schedules', 'devices', 'settings'];
// Fixed clock: the greeting, schedules and "next alarm" texts depend on the time.
const NOW = new Date('2026-11-07T20:41:00+01:00');

async function boot(page: Page, storage: Record<string, unknown>) {
  // Time stands still unless a test advances it: live previews render the same frame every run.
  await page.clock.install({ time: NOW.getTime() - 60_000 });
  await page.clock.pauseAt(NOW);
  await page.addInitScript((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
  }, storage);
  // No network: the app must look right offline (discovery and update checks fail fast).
  await page.route(/^(?!http:\/\/localhost)/, (r) => r.abort());
}

const shot = async (page: Page, name: string, project: string) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot(`${name}-${project}.png`, { fullPage: true });
};

test.describe('pages (simulator)', () => {
  for (const id of PAGES) {
    test(id, async ({ page }, info) => {
      await boot(page, { 'gp.settings': { mode: 'simulator', onboarded: true } });
      await page.goto(`/#${id}`);
      await page.locator('main').waitFor();
      await page.clock.runFor(1500); // simulated light connects
      await shot(page, id, info.project.name);
    });
  }
});

test('Take control banner (Direct Bluetooth, light not reachable)', async ({ page }, info) => {
  await boot(page, {
    'gp.settings': { mode: 'local', onboarded: true },
    'gp.devices': [{ id: 'BE:27:DA:00:7C:83', name: 'ELK-BLEDDM', driverId: 'elk' }],
    'gp.light.BE:27:DA:00:7C:83': { on: true, color: { r: 255, g: 42, b: 0 }, brightness: 14, speed: 50, controllerEffect: null },
  });
  await page.goto('/#home');
  await expect(page.getByRole('button', { name: /Take control/ }).first()).toBeVisible();
  await shot(page, 'take-control', info.project.name);
});

test('Noyau card (connected to a hub)', async ({ page }, info) => {
  await boot(page, { 'gp.settings': { mode: 'remote', onboarded: true, remoteUrl: 'ws://127.0.0.1:1', remoteTokens: { 'ws://127.0.0.1:1': 't' }, noyauUser: 'erwann' } });
  // Fake hub: answers the WebSocket handshake with a hub state.
  await page.addInitScript(() => {
    const state = {
      snapshot: { light: { on: true, color: { r: 139, g: 92, b: 246 }, brightness: 60, speed: 50, controllerEffect: null }, activeSceneId: null, softwareEffect: null, sleepTimerEndsAt: null, ramp: null, activeRule: null, mixStepSceneId: null },
      status: 'connected', deviceName: 'ELK-BLEDDM', scenes: [], rules: [], schedules: [], foreground: null, owner: 'hub',
      lights: [{ id: 'l1', name: 'ELK-BLEDDM', status: 'connected' }], groups: [], hub: true, scan: [], scanning: false,
      noyau: { url: 'https://noyau.example.ts.net', musicSync: true, colors: ['#8b5cf6', '#f97316', '#3b82f6'], target: 'all', hasToken: true, status: 'listening', playing: true },
    };
    class FakeWS {
      static OPEN = 1;
      readyState = 0;
      onopen?: () => void;
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
      constructor() { setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 10); }
      send(d: string) {
        const m = JSON.parse(d);
        if (m.t === 'auth') setTimeout(() => { this.onmessage?.({ data: JSON.stringify({ t: 'authed' }) }); this.onmessage?.({ data: JSON.stringify({ t: 'state', state }) }); }, 10);
      }
      close() {}
    }
    (window as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  });
  await page.goto('/#settings');
  await page.clock.runFor(500);
  const card = page.locator('section, div').filter({ has: page.getByText('Noyau', { exact: true }) }).filter({ hasText: 'Sign in with your Noyau account' }).last();
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveScreenshot(`noyau-card-${info.project.name}.png`);
});
