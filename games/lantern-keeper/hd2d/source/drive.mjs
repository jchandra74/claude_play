// Keyboard play-through helpers: A* on the game's own walk grid, then arrow-key steering.
import { sleep, shot, lk } from './playtest.mjs';
const STEP = 0.25;
const BOX = { town: [-15.5, -13.5, 21.8, 4.8], forest: [594, -9, 650, 7] };
const gridCache = {};
export async function grid(page, area, fresh) {
  if (gridCache[area] && !fresh) return gridCache[area];
  const [x0, z0, x1, z1] = BOX[area];
  const g = await page.evaluate(([a, x0, z0, x1, z1, s]) => LK.grid(a, x0, z0, x1, z1, s), [area, x0, z0, x1, z1, STEP]);
  return gridCache[area] = { g, x0, z0 };
}
function astar(G0, sx, sz, tx, tz) {
  const { x0, z0 } = G0, nz = G0.g.length, nx = G0.g[0].length;
  // erode: keep a one-cell margin from obstacles so steering never clips corners
  const g = G0.g;
  const pen = G0.g.map((r, j) => r.map((v, i) => { for (const [a, b] of [[1,0],[-1,0],[0,1],[0,-1]]) { const w = (G0.g[j + b] || [])[i + a]; if (w === -99) return 4; } return 0; }));
  const ci = x => Math.round((x - x0) / STEP), cj = z => Math.round((z - z0) / STEP);
  const nearestFree = (i, j) => { let best = null, bd = 1e9; for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz || g[b][a] === -99) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = [a, b]; } } return best; };
  let s = nearestFree(ci(sx), cj(sz)), t = nearestFree(ci(tx), cj(tz));
  if (!s || !t) return null;
  const key = (i, j) => j * nx + i;
  const open = new Map(), came = new Map(), gs = new Map();
  gs.set(key(...s), 0); open.set(key(...s), s);
  const h = (i, j) => Math.hypot(i - t[0], j - t[1]);
  while (open.size) {
    let bk = null, bf = 1e9;
    for (const [k, [i, j]] of open) { const f = gs.get(k) + h(i, j); if (f < bf) { bf = f; bk = k; } }
    const [i, j] = open.get(bk); open.delete(bk);
    if (i === t[0] && j === t[1]) {
      const path = []; let k = bk;
      while (k !== undefined) { const ii = k % nx, jj = Math.floor(k / nx); path.unshift([x0 + ii * STEP + 0.013, z0 + jj * STEP + 0.013]); k = came.get(k); }
      return path;
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || g[b][a] === -99) continue;
      if (Math.abs(g[b][a] - g[j][i]) > 0.3) continue;
      if (di && dj && (g[j][a] === -99 || g[b][i] === -99)) continue;
      const k = key(a, b), ng = gs.get(bk) + Math.hypot(di, dj) + pen[b][a];
      if (ng < (gs.get(k) ?? 1e9)) { gs.set(k, ng); came.set(k, bk); open.set(k, [a, b]); }
    }
  }
  return null;
}
async function pos(page) { return page.evaluate(() => LK.player); }
export async function frames(page, n) { const f0 = await page.evaluate(() => window.__frames); await page.waitForFunction(f => window.__frames >= f, f0 + n, { polling: 30, timeout: 120000 }); }
export async function hold(page, keys, ms) { for (const k of keys) await page.keyboard.down(k); await frames(page, Math.max(1, Math.round(ms / 150))); for (const k of keys) await page.keyboard.up(k); await frames(page, 1); }
export async function walkTo(page, tx, tz, opts = {}) {
  for (let tries = 0; tries < 5; tries++) { const r = await walkTo1(page, tx, tz, opts); if (r) return true; const k = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'][tries % 4]; await hold(page, [k], 250); }
  return false;
}
async function walkTo1(page, tx, tz, opts = {}) {
  let p = await pos(page);
  const G = await grid(page, p.area, true);
  const path = astar(G, p.x, p.z, tx, tz);
  if (!path) { console.log('no path to', tx, tz, 'from', p); return false; }
  // thin the path
  const wps = path.filter((_, i) => i % 2 === 0 || i === path.length - 1);
  let stuck = 0, last = null;
  for (let w = 0; w < wps.length; w++) {
    const [wx, wz] = wps[w];
    for (let it = 0; it < 60; it++) {
      p = await pos(page);
      if (p.area !== G.area && opts.allowArea) return true;
      const dx = wx - p.x, dz = wz - p.z, d = Math.hypot(dx, dz);
      if (d < (w === wps.length - 1 ? 0.18 : 0.28)) break;
      const keys = [];
      if (dx > 0.12) keys.push('ArrowRight'); else if (dx < -0.12) keys.push('ArrowLeft');
      if (dz > 0.12) keys.push('ArrowDown'); else if (dz < -0.12) keys.push('ArrowUp');
      await hold(page, keys, Math.min(450, 120 + d * 150));
      if (last && Math.hypot(last.x - p.x, last.z - p.z) < 0.02) { if (++stuck > 4) { console.log('stuck at', JSON.stringify(p), 'wp', wx.toFixed(2), wz.toFixed(2)); return false; } } else stuck = 0;
      last = p;
    }
  }
  return true;
}
export async function face(page, dir) {
  const k = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[dir];
  await page.keyboard.down(k); await frames(page, 1); await page.keyboard.up(k); await frames(page, 1);
}
// one press = key down for exactly one rendered frame (the game reads presses per frame)
export async function press(page, k = 'z') { await page.keyboard.down(k); await frames(page, 1); await page.keyboard.up(k); await frames(page, 1); }
// advance dialogue until the script is idle. choices: list of indices to pick in order
export async function talkThrough(page, choices = [], opts = {}) {
  const log = [];
  let ci = 0, idle = 0;
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => ({ dlg: LK.dlg, sp: LK.speaker, ch: LK.choice, busy: LK.busy, mode: LK.mode, menu: LK.menu }));
    if (opts.until && opts.until(s)) return log;
    if (s.ch) {
      const want = choices[ci++] || 0;
      for (let k = 0; k < want; k++) { await press(page, 'ArrowDown'); await sleep(150); }
      log.push('> ' + s.ch[want]);
      await sleep(250); await press(page, 'z'); await sleep(300); continue;
    }
    if (s.dlg) {
      if (log[log.length - 1] !== (s.sp || '') + ': ' + s.dlg) { log.push((s.sp || '') + ': ' + s.dlg); if (opts.onLine) await opts.onLine(s, log.length); }
      await press(page, 'z'); await sleep(200); idle = 0; continue;
    }
    if (s.menu && opts.stopAtMenu) return log;
    if (!s.busy) { if (++idle > 3) return log; } else idle = 0;
    await sleep(300);
  }
  return log;
}
// battle autopilot (keyboard): exploits weaknesses, heals with cookies, boosts on Gerald
export async function fight(page, opts = {}) {
  const log = [];
  let shots = 0;
  for (let i = 0; i < 2000; i++) {
    const s = await page.evaluate(() => ({ mode: LK.mode, dlg: LK.dlg, sp: LK.speaker, b: LK.battleState, inv: { ...LK.inventory } }));
    if (s.mode !== 'battle') return log;
    if (s.dlg) { log.push((s.sp || '') + ': ' + s.dlg); await press(page, 'z'); await sleep(250); continue; }
    const b = s.b;
    if (!b || b.menu !== 'cmd') { if (b && b.msg && log[log.length - 1] !== '* ' + b.msg) log.push('* ' + b.msg); await sleep(250); continue; }
    if (opts.onMenu && shots < (opts.maxShots || 1)) { await opts.onMenu(b); shots++; }
    const me = b.party.find(p => p.id === b.actor), foes = b.enemies.filter(e => e.alive);
    const hurt = b.party.find(p => p.hp > 0 && p.hp < (p.id === 'pip' ? 45 : 38));
    const keys = [];
    const boost = (b.bp[b.actor] >= 3 && foes.some(f => f.kind === 'gerald')) ? 2 : (b.bp[b.actor] >= 2 && foes.some(f => f.broken)) ? 1 : 0;
    for (let k = 0; k < boost; k++) keys.push('e');
    let t = Math.max(0, foes.findIndex(f => f.broken));
    if (hurt && s.inv.cookie > 0) {
      const items = Object.keys(s.inv).filter(k => s.inv[k] > 0);
      keys.length = 0; keys.push('ArrowDown', 'ArrowDown', 'z');
      for (let k = 0; k < items.indexOf('cookie'); k++) keys.push('ArrowDown');
      keys.push('z');
      const ally = b.party.filter(p => p.hp > 0).findIndex(p => p.id === hurt.id);
      for (let k = 0; k < ally; k++) keys.push('ArrowDown');
      keys.push('z');
      log.push(`[${b.actor}] cookie -> ${hurt.id}`);
    } else if (b.actor === 'pip') {
      const shrub = foes.findIndex(f => f.kind === 'shrub' && !f.broken);
      if (shrub >= 0 && me.sp >= 6) { keys.push('ArrowDown', 'z', 'z'); t = shrub; log.push('[pip] Flicker'); }
      else { keys.push('z'); log.push('[pip] Attack'); }
      for (let k = 0; k < t; k++) keys.push('ArrowRight');
      keys.push('z');
    } else {
      const sassy = foes.findIndex(f => (f.kind === 'moth' || f.kind === 'gerald'));
      if (sassy >= 0 && me.sp >= 6 && !foes[t].broken) { keys.push('ArrowDown', 'z', 'z'); t = sassy; log.push('[moss] Withering Remark'); }
      else if (foes.length > 1 && me.sp >= 8) { keys.push('ArrowDown', 'z', 'ArrowDown', 'z'); log.push('[moss] Pebble Storm'); t = -1; }
      else { keys.push('z'); log.push('[moss] Attack'); }
      if (t >= 0) { for (let k = 0; k < t; k++) keys.push('ArrowRight'); keys.push('z'); }
    }
    for (const k of keys) { await press(page, k); await sleep(170); }
    await sleep(400);
  }
  return log;
}

export async function talkTo(page, id, x, z, dir, choices = [], opts = {}) {
  const ok = await walkTo(page, x, z);
  for (const d of [dir, 'up', 'left', 'right', 'down']) {
    await face(page, d); await sleep(350);
    const t = await page.evaluate(() => LK.target);
    if (t === id) { await press(page, 'z'); await sleep(300); const log = await talkThrough(page, choices, opts); console.log(`talk ${id}: ok`); return log; }
  }
  console.log(`talk ${id}: FAILED (walk ${ok})`, JSON.stringify(await page.evaluate(() => [LK.player, LK.target])));
  return [];
}
