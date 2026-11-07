import { expect, test } from '@playwright/test';

// Why the 360 px sideways scroll slipped through: the screenshots are cut at the viewport width (a page
// that is too wide still looks fine), the viewport was 375 px, the light was the short simulator one,
// and nobody used a big system font like the Samsung did. This checks the layout itself instead.

const PAGES = ['home', 'devices', 'color', 'effects', 'scenes', 'automation', 'schedules', 'settings'];
const WIDTHS = [320, 360, 412];
// Android "font size" setting scales the WebView text; 100 % to 150 % covers the usual choices.
const FONT_SCALES = [1, 1.3, 1.5];

const realLight = {
  'gp.settings': { mode: 'local', onboarded: true },
  'gp.devices': [{ id: 'BE:27:DA:00:7C:83', name: 'ELK-BLEDDM', driverId: 'elk' }],
  'gp.light.BE:27:DA:00:7C:83': { on: true, color: { r: 255, g: 42, b: 0 }, brightness: 14, speed: 50, controllerEffect: null },
};

test.describe('no sideways scroll on phones', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layouts only');

  for (const width of WIDTHS) {
    test(`every page fits ${width} px at every font size`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((s) => {
        localStorage.clear();
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
      }, realLight);
      await page.route(/^(?!http:\/\/localhost)/, (r) => r.abort());
      await page.goto('/#home');
      await page.locator('main').waitFor();
      const problems: string[] = [];
      for (const scale of FONT_SCALES) {
        await page.evaluate((s) => { document.documentElement.style.fontSize = `${s * 100}%`; }, scale);
        for (const id of PAGES) {
          await page.evaluate((p) => { location.hash = `#${p}`; }, id);
          await page.waitForTimeout(250);
          const r = await page.evaluate(() => {
            const W = document.documentElement.clientWidth;
            const wide = [...document.querySelectorAll('main *, header *')]
              .filter((e) => e.getBoundingClientRect().right > W + 1 && !e.closest('.pointer-events-none'))
              .filter((e) => ![...e.children].some((c) => c.getBoundingClientRect().right > W + 1))
              .slice(0, 3)
              .map((e) => `<${e.tagName.toLowerCase()} class="${String(e.className).slice(0, 60)}"> "${(e as HTMLElement).innerText?.slice(0, 30) ?? ''}"`);
            return { sw: document.documentElement.scrollWidth, W, wide };
          });
          if (r.sw > r.W) problems.push(`${id} @ ${width}px, font ${scale * 100}%: page is ${r.sw}px wide → ${r.wide.join(' | ') || '(see layout)'}`);
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
