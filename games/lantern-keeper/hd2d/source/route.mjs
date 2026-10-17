// Walk from Moss's bench to Guard Barnaby like a person would: hold Right, nudge Down/Up when blocked.
import { open, sleep, shot } from './playtest.mjs';
import { frames, hold, face, press } from './drive.mjs';
const vp = process.env.VP ? process.env.VP.split('x').map(Number) : [844, 390];
const TOUCH = !!process.env.TOUCH;
const { browser, page } = await open('dtmax=0.3&scene=moss', { width: vp[0], height: vp[1] }, { touch: TOUCH });
const pos = () => page.evaluate(() => LK.player);
const tag = (TOUCH ? 'touch' : 'keys') + '_' + vp[0];
console.log('start');
let cdp;
if (TOUCH) cdp = await page.context().newCDPSession(page);
const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
async function go(dx, dy, n) {   // dx,dy in -1..1
  if (!TOUCH) { const ks = []; if (dx > 0) ks.push('ArrowRight'); if (dx < 0) ks.push('ArrowLeft'); if (dy > 0) ks.push('ArrowDown'); if (dy < 0) ks.push('ArrowUp'); await hold(page, ks, n * 150); return; }
  const bx = 150, by = vp[1] - 90;
  await tp('touchStart', bx, by); await frames(page, 1);
  await tp('touchMove', bx + dx * 30, by + dy * 30); await frames(page, 1);
  await tp('touchMove', bx + dx * 60, by + dy * 60); await frames(page, n);
  await tp('touchEnd'); await frames(page, 1);
}
await sleep(1000);
await shot(page, `w_${tag}_0`);
let p = await pos(), stuck = 0, steps = 0, si = 1;
const t0 = Date.now();
while (p.x < 18.4 && steps < 120) {
  const before = p;
  await go(1, 0, 3); steps++;
  p = await pos();
  if (p.x - before.x < 0.05) {   // blocked: sidestep the way that looks open
    stuck++;
    // blocked: a player steers diagonally round it (down first, the plaza's open side)
    await go(1, Math.floor(stuck / 3) % 2 ? -1 : 1, 4); p = await pos();
  }
  console.log('step', steps, JSON.stringify(p), (Date.now() - t0) / 1000);
  if (steps % 6 === 0) await shot(page, `w_${tag}_${si++}`);
}
console.log(tag, 'reached', JSON.stringify(p), 'holds', steps, 'blocked', stuck, 'secs', (Date.now() - t0) / 1000);
// line up with Barnaby and talk
for (let i = 0; i < 12; i++) {
  const dx = 18.55 - p.x, dz = 0.5 - p.z;
  if (Math.hypot(dx, dz) < 0.3) break;
  await go(Math.abs(dx) > 0.15 ? Math.sign(dx) : 0, Math.abs(dz) > 0.15 ? Math.sign(dz) : 0, 1); p = await pos();
}
await go(1, 0, 1);
await shot(page, `w_${tag}_barnaby`);
console.log('target', await page.evaluate(() => LK.target), JSON.stringify(await pos()));
await browser.close();
