// Moss -> gate with the touch stick, steering the way the goal chevron points (as a player would).
// START=x,z (default: Moss's bench). Logs progress, shots every few seconds.
import { open, sleep, shot } from './playtest.mjs';
import { frames } from './drive.mjs';
const W = 844, H = 390;
const { browser, page } = await open('dtmax=0.3&scene=moss', { width: W, height: H }, { touch: true });
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const tag = process.env.TAG || 'moss';
if (process.env.START) { const [x, z] = process.env.START.split(',').map(Number); await page.evaluate(([x, z]) => { LK.teleport(x, z); }, [x, z]); }
await frames(page, 4);
const t0 = Date.now();
let n = 0, stuck = 0, last = null, path = 0;
const bx = 150, by = 300;
await touch('touchStart', bx, by); await frames(page, 1);
for (let i = 0; i < 400; i++) {
  const s = await page.evaluate(() => ({ p: LK.player, h: LK.routeHint(), target: LK.target, f: LK.follower }));
  if (s.target === 'barnaby') { console.log('reached Barnaby talk range at', JSON.stringify(s.p), 'steps', i, 'path m', path.toFixed(1)); break; }
  if (!s.h || !s.h.w) { console.log('no hint', JSON.stringify(s)); break; }
  const dx = s.h.w[0] - s.p.x, dz = s.h.w[1] - s.p.z, d = Math.hypot(dx, dz) || 1;
  await touch('touchMove', bx + dx / d * 50, by + dz / d * 50);
  await frames(page, 2);
  if (last) { const m = Math.hypot(s.p.x - last.x, s.p.z - last.z); path += m; if (m < 0.01) stuck++; else stuck = 0; if (s.f) { const g = Math.hypot(s.f.x - s.p.x, s.f.z - s.p.z); globalThis.maxGap = Math.max(globalThis.maxGap || 0, g); } }
  if (stuck > 12) { console.log('STUCK at', JSON.stringify(s.p)); await shot(page, 'tg_stuck_' + tag); break; }
  last = s.p;
  if (i % 12 === 0) { await shot(page, `tg_${tag}_${String(n++).padStart(2, '0')}`); console.log(i, JSON.stringify(s.p), 'hint', s.h.w.map(v => v.toFixed(2)).join(',')); }
}
await touch('touchEnd'); await frames(page, 2);
console.log('max Moss gap', (globalThis.maxGap || 0).toFixed(2), 'secs', (Date.now() - t0) / 1000);
await browser.close();
