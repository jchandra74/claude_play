// Screenshot: node shoot.mjs [view ...] [--quality=high] -> shots/<view>.png at 1920x1080
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const q = (args.find(a => a.startsWith('--quality=')) || '--quality=high').split('=')[1];
const suffix = (args.find(a => a.startsWith('--suffix=')) || '--suffix=').split('=')[1];
let views = args.filter(a => !a.startsWith('--'));
if (!views.length) views = ['full', 'house', 'lantern', 'characters', 'terrain', 'tree'];
fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const v of views) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${v}] ${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', e => console.log(`[${v}] pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto('file://' + path.join(root, 'dist/plaza.html') + `?view=${v}&quality=${q}&t=7.3`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 600000, polling: 500 });
  const err = await page.evaluate(() => window.__error);
  if (err) { console.log(`[${v}] ERROR ${err}`); await page.close(); continue; }
  const out = path.join(root, 'shots', `${v}${suffix}.png`);
  await page.screenshot({ path: out, timeout: 240000 });
  console.log(`shot ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.close();
}
await browser.close();
