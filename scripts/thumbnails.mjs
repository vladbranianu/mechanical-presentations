/*
 * Renders a static thumbnail for every presentation in the catalog.
 *
 *   npm run build && npm run preview   (in another terminal)
 *   npm run thumbnails [-- slug ...]
 *
 * Needs a Chromium for Playwright (`npx playwright install chromium`, or set CHROMIUM_PATH).
 * Opens /p/<slug>?capture (no UI, paused, labels off) and saves public/thumbnails/<slug>.jpg.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const catalog = readFileSync(new URL('../src/presentations/catalog.ts', import.meta.url), 'utf8');
const all = [...catalog.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : all;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 750 }, reducedMotion: 'reduce' });
for (const slug of slugs) {
  await page.goto(`${BASE}/p/${slug}?capture`);
  await page.waitForFunction(() => window.__captureReady === true, null, { timeout: 120_000 });
  const path = new URL(`../public/thumbnails/${slug}.jpg`, import.meta.url).pathname;
  await page.screenshot({ path, type: 'jpeg', quality: 82 });
  console.log('saved', path);
}
await browser.close();
