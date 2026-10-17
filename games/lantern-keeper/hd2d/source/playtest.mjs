// Play-test driver: node playtest.mjs <script.json-ish via env> ; used interactively by the builder.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function open(q = '', vp = { width: 844, height: 390 }, opts = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: vp, hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { logs.push(m.text()); console.log('[console]', m.type(), m.text().slice(0, 300)); } });
  page.on('pageerror', e => { logs.push(e.message); console.log('[pageerror]', e.message); page.evaluate(m => { window.__error = window.__error || m; }, e.message).catch(() => {}); });
  // default to the low preset unless the caller (or QUALITY=) asks for one; the requested value must win
  const want = process.env.QUALITY ? 'quality=' + process.env.QUALITY : '';
  const qq = [q, want].filter(Boolean).join('&');
  await page.goto('file://' + path.join(root, 'dist/plaza.html') + '?' + (/(^|&)quality=/.test(qq) ? qq : 'quality=low' + (qq ? '&' + qq : '')));
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 600000, polling: 500 });
  const err = await page.evaluate(() => window.__error);
  if (err) console.log('ERROR', err);
  return { browser, page, logs };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function shot(page, name) { fs.mkdirSync(path.join(root, 'shots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'shots', name + '.png') }); console.log('shot', name); }
export async function lk(page) { return page.evaluate(() => ({ mode: LK.mode, area: LK.area, dlg: LK.dlg, speaker: LK.speaker, busy: LK.busy, choice: LK.choice, player: LK.player, target: LK.target, fade: LK.fade, battle: LK.battleState, lantern: LK.lantern, flags: { ...LK.flags } })); }
