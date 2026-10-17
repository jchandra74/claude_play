// 2D overlay: input (keyboard + floating touch stick + A/B/menu buttons, same scheme as the original)
// and every piece of UI drawn on a canvas above the WebGL view: typewriter dialogue with portraits,
// choices, toasts, cinematic bars, fades, pause menu, title and end card, rotate-your-phone prompt.
// Ported from the original 2D game, using a system serif font (no web fonts, no network).
import { G, blocking, party, inventory, ITEMS } from './game_state.js';
import { audio, sfx } from './game_audio.js';
import { PORTRAIT } from './game_tex.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const easeOut = t => 1 - (1 - t) * (1 - t);
export const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export const cv = document.createElement('canvas');
cv.id = 'ui';
cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;touch-action:none;z-index:2;';
export const D = cv.getContext('2d');
export const V = { DPR: 1, W: 0, H: 0, cssW: 0, cssH: 0, S: 2, VW: 0, VH: 0 };
export const safe = { l: 0, r: 0, t: 0, b: 0 };
const safeEl = document.createElement('div');
safeEl.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';

export function mountUI() {
  document.body.appendChild(cv);
  document.body.appendChild(safeEl);
  resizeUI();
  window.addEventListener('resize', resizeUI);
}
export function resizeUI() {
  V.DPR = Math.min(window.devicePixelRatio || 1, 2);
  V.cssW = window.innerWidth; V.cssH = window.innerHeight;
  V.W = Math.round(V.cssW * V.DPR); V.H = Math.round(V.cssH * V.DPR);
  cv.width = V.W; cv.height = V.H;
  V.S = Math.max(1.6, V.H / 216);
  if (V.W / V.S < 340) V.S = Math.max(1.2, V.W / 340);
  V.VW = V.W / V.S; V.VH = V.H / V.S;
  const st = getComputedStyle(safeEl);
  safe.t = parseFloat(st.paddingTop) || 0; safe.r = parseFloat(st.paddingRight) || 0;
  safe.b = parseFloat(st.paddingBottom) || 0; safe.l = parseFloat(st.paddingLeft) || 0;
  layoutControls();
}

// ---------- input ----------
export const keys = new Set();
export const inp = { mx: 0, my: 0, run: false, a: false, b: false, stickRun: false };
export const pressed = { a: false, b: false, menu: false, up: false, down: false, left: false, right: false, boostUp: false, boostDown: false, tap: false };
export const touch = { ui: ('ontouchstart' in window) || navigator.maxTouchPoints > 0 };
const ptrs = new Map();
export const stick = { active: false, id: -1, bx: 0, by: 0, x: 0, y: 0, hx: 0, hy: 0, r: 46 };
export const btns = {
  A: { x: 0, y: 0, r: 36, down: false },
  B: { x: 0, y: 0, r: 27, down: false },
  MENU: { x: 0, y: 0, r: 21, down: false },
};
export let hits = [];
export const lastTap = { x: -1, y: -1 };
export function clearHits() { hits = []; }
const navRepeat = { dir: '', t: 0 };

function layoutControls() {
  stick.hx = safe.l + 92; stick.hy = V.cssH - safe.b - 84;
  btns.A.x = V.cssW - safe.r - 66; btns.A.y = V.cssH - safe.b - 84;
  btns.B.x = V.cssW - safe.r - 140; btns.B.y = V.cssH - safe.b - 50;
  btns.MENU.x = V.cssW - safe.r - 36; btns.MENU.y = safe.t + 32;
}
export const buttonsVisible = () => touch.ui && G.mode === 'field' && !blocking();
export const stickVisible = () => touch.ui && G.mode === 'field' && !blocking();
const blockingNav = () => !!(G.choiceBox || G.menuOpen || G.mode === 'battle');
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (e.pointerType === 'touch') touch.ui = true;
  audio.unlock();
  tryFullscreen(e);
  const x = e.clientX, y = e.clientY;
  // the rotate-your-phone card is modal: a tap on it must not start the game underneath
  if (touch.ui && V.cssH > V.cssW * 1.05) return;
  const p = { role: 'tap', x, y };
  ptrs.set(e.pointerId, p);
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (x * V.DPR >= h.x && x * V.DPR <= h.x + h.w && y * V.DPR >= h.y && y * V.DPR <= h.y + h.h) { p.role = 'ui'; h.fn(); return; }
  }
  if (touch.ui && G.mode === 'field') {
    for (const k in btns) {
      const b = btns[k];
      if ((k === 'MENU' ? !blocking() : buttonsVisible()) && dist(x, y, b.x, b.y) < b.r + 14) {
        p.role = k; b.down = true;
        if (k === 'A') { pressed.a = true; inp.a = true; }
        if (k === 'B') { pressed.b = true; inp.b = true; }
        if (k === 'MENU') pressed.menu = true;
        return;
      }
    }
    if (x < V.cssW * 0.5 && stickVisible() && !stick.active) {
      p.role = 'stick'; stick.active = true; stick.id = e.pointerId;
      stick.bx = x; stick.by = y; stick.x = x; stick.y = y;
      return;
    }
  }
  pressed.tap = true; lastTap.x = x * V.DPR; lastTap.y = y * V.DPR;
}, { passive: false });
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (p.role === 'stick') {
    const dx = p.x - stick.bx, dy = p.y - stick.by, d = Math.hypot(dx, dy);
    if (d > stick.r * 1.6) { stick.bx += dx * (1 - stick.r * 1.6 / d); stick.by += dy * (1 - stick.r * 1.6 / d); }
    stick.x = p.x; stick.y = p.y;
  }
}, { passive: false });
function endPtr(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  if (p.role === 'stick') { stick.active = false; stick.id = -1; }
  if (btns[p.role]) {
    btns[p.role].down = false;
    if (p.role === 'A') inp.a = false;
    if (p.role === 'B') inp.b = false;
  }
  ptrs.delete(e.pointerId);
}
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
document.addEventListener('gesturestart', e => e.preventDefault());

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', Space: 'a', Enter: 'a', KeyX: 'b', Escape: 'b', Backspace: 'b', KeyC: 'menu', Tab: 'menu', KeyM: 'menu',
  KeyE: 'boostUp', KeyR: 'boostUp', KeyQ: 'boostDown',
};
window.addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.run = true;
  if (!k) return;
  e.preventDefault();
  audio.unlock();
  if (!e.repeat) {
    pressed[k] = true;
    if (k === 'a') inp.a = true;
    if (k === 'b') inp.b = true;
  }
  if (['up', 'down', 'left', 'right'].includes(k) && e.repeat && blockingNav()) pressed[k] = true;
  keys.add(k);
});
window.addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.run = false;
  if (!k) return;
  keys.delete(k);
  if (k === 'a') inp.a = false;
  if (k === 'b') inp.b = false;
});
window.addEventListener('blur', () => { keys.clear(); inp.a = inp.b = inp.run = false; });

export function pollInput(dt) {
  let mx = 0, my = 0;
  if (keys.has('left')) mx -= 1;
  if (keys.has('right')) mx += 1;
  if (keys.has('up')) my -= 1;
  if (keys.has('down')) my += 1;
  const mag = Math.hypot(mx, my);
  if (mag > 0) { mx /= mag; my /= mag; }
  let fromStick = false;
  if (stick.active) {
    const dx = stick.x - stick.bx, dy = stick.y - stick.by, d = Math.hypot(dx, dy);
    if (d > stick.r * 0.18) { const m = Math.min(1, d / stick.r); mx = dx / d * m; my = dy / d * m; fromStick = true; }
  }
  inp.mx = mx; inp.my = my;
  inp.stickRun = fromStick && Math.hypot(mx, my) > 0.96;
  let dir = '';
  if (fromStick) {
    if (Math.abs(mx) > Math.abs(my)) dir = mx > 0.5 ? 'right' : mx < -0.5 ? 'left' : '';
    else dir = my > 0.5 ? 'down' : my < -0.5 ? 'up' : '';
  }
  if (dir && dir !== navRepeat.dir) { pressed[dir] = true; navRepeat.dir = dir; navRepeat.t = 0.38; }
  else if (dir) { navRepeat.t -= dt; if (navRepeat.t <= 0) { pressed[dir] = true; navRepeat.t = 0.12; } }
  else navRepeat.dir = '';
}
export function clearPressed() { for (const k in pressed) pressed[k] = false; }

function tryFullscreen(e) {
  if (e.pointerType !== 'touch' || document.fullscreenElement || tryFullscreen.done) return;
  tryFullscreen.done = true;
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }
}

// ---------- drawing primitives ----------
export const FONT = '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, "DejaVu Serif", serif';
export const UIC = {
  text: '#fff8ea', dim: '#c4b8de', gold: '#ffd75a', red: '#ff6a6a', green: '#7aeb8a', blue: '#7ac8ff',
};
export function font(px, weight = 500) { return `${weight} ${Math.round(px)}px ${FONT}`; }
export function rr(x, y, w, h, r) {
  D.beginPath(); D.moveTo(x + r, y); D.arcTo(x + w, y, x + w, y + h, r); D.arcTo(x + w, y + h, x, y + h, r);
  D.arcTo(x, y + h, x, y, r); D.arcTo(x, y, x + w, y, r); D.closePath();
}
export function panel(x, y, w, h, opts = {}) {
  const u = V.S, r = opts.r || 3 * u;
  D.save();
  D.fillStyle = 'rgba(0,0,0,0.35)';
  rr(x + u, y + 2 * u, w, h, r); D.fill();
  const g = D.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, opts.top || 'rgba(38,30,74,0.94)'); g.addColorStop(1, opts.bot || 'rgba(12,10,30,0.95)');
  D.fillStyle = g; rr(x, y, w, h, r); D.fill();
  D.lineWidth = Math.max(1, u * 0.6); D.strokeStyle = opts.edge || '#e9d39a';
  rr(x + u * 0.5, y + u * 0.5, w - u, h - u, r * 0.8); D.stroke();
  D.lineWidth = Math.max(1, u * 0.3); D.strokeStyle = 'rgba(170,150,255,0.4)';
  rr(x + u * 1.6, y + u * 1.6, w - u * 3.2, h - u * 3.2, r * 0.6); D.stroke();
  // little gold corner studs (storybook frame)
  if (!opts.noStuds && w > 30 * u && h > 20 * u) {
    D.fillStyle = '#f4e2b0';
    for (const [cx, cy] of [[x + 2.2 * u, y + 2.2 * u], [x + w - 2.2 * u, y + 2.2 * u], [x + 2.2 * u, y + h - 2.2 * u], [x + w - 2.2 * u, y + h - 2.2 * u]]) {
      D.beginPath(); D.moveTo(cx, cy - u); D.lineTo(cx + u, cy); D.lineTo(cx, cy + u); D.lineTo(cx - u, cy); D.fill();
    }
  }
  D.restore();
}
export function text(str, x, y, size, col = UIC.text, align = 'left', weight = 500, shadow = true) {
  D.font = font(size, weight); D.textAlign = align; D.textBaseline = 'top';
  if (shadow) { D.fillStyle = 'rgba(10,4,24,0.85)'; D.fillText(str, x + size * 0.08, y + size * 0.1); }
  D.fillStyle = col; D.fillText(str, x, y);
}
export function wrap(str, maxW) {
  const out = [];
  for (const para of str.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (D.measureText(test).width > maxW && line) { out.push(line); line = w; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}
export function bar(x, y, w, h, f, col, label) {
  D.fillStyle = 'rgba(0,0,0,0.5)'; rr(x, y, w, h, h / 2); D.fill();
  if (f > 0) { D.fillStyle = col; rr(x, y, Math.max(h, w * clamp(f, 0, 1)), h, h / 2); D.fill(); }
  if (label) text(label, x + w, y - h * 2.4, h * 1.9, UIC.dim, 'right', 600, false);
}

// ---------- dialogue ----------
const VOICES = { Pip: 1.2, Moss: 0.8, 'Grandpa Odo': 0.6, 'Mayor Bramblewick': 0.75, 'Mrs. Pennywhistle': 1.3, 'Madame Zuzu': 0.95, Gerald: 0.55, Tobin: 1.5, 'Guard Barnaby': 0.7, 'Mr. Fenwick': 0.7, 'Fisherman Glen': 0.85, 'Guard Wendell': 0.8 };
const PORTRAITS = { 'Grandpa Odo': 'odo', 'Mayor Bramblewick': 'mayor', Moss: 'moss', 'Mrs. Pennywhistle': 'baker', 'Madame Zuzu': 'zuzu', 'Mr. Fenwick': 'fenwick', Tobin: 'tobin', 'Fisherman Glen': 'glen', 'Guard Barnaby': 'barnaby', Pip: 'pip', Gerald: 'gerald', 'Guard Wendell': 'wendell' };

export function updateDialog(dt) {
  const dlg = G.dlg;
  if (dlg) {
    dlg.t += dt;
    const total = dlg.text.length;
    if (dlg.shown < total) {
      const before = Math.floor(dlg.shown);
      dlg.shown = Math.min(total, dlg.shown + dt * 52);
      if (Math.floor(dlg.shown) !== before && Math.floor(dlg.shown) % 2 === 0 && /\w/.test(dlg.text[Math.floor(dlg.shown)] || '')) sfx('blip', VOICES[dlg.name] || 1);
      if ((pressed.a || pressed.tap) && dlg.t > 0.08) dlg.shown = total;
    } else if ((pressed.a || pressed.tap) && dlg.t > 0.15) {
      const r = dlg.res; G.dlg = null; r();
    }
    // only Z / Space / Enter / tap advance text (X and Esc no longer skip lines by accident)
    pressed.a = pressed.tap = pressed.b = false;
  }
  const cb = G.choiceBox;
  if (cb) {
    cb.t += dt;
    const n = cb.opts.length;
    if (pressed.up || pressed.left) { cb.sel = (cb.sel + n - 1) % n; sfx('move'); }
    if (pressed.down || pressed.right) { cb.sel = (cb.sel + 1) % n; sfx('move'); }
    if (pressed.a && cb.t > 0.15) { const r = cb.res, s = cb.sel; G.choiceBox = null; sfx('ok'); r(s); }
    pressed.a = pressed.tap = pressed.b = pressed.up = pressed.down = pressed.left = pressed.right = false;
  }
  for (let i = G.toasts.length - 1; i >= 0; i--) { G.toasts[i].t += dt; if (G.toasts[i].t > TOAST_T) G.toasts.splice(i, 1); }
  const f = G.fade;
  if (f.a !== f.target) {
    const d = f.speed * dt;
    f.a = f.a < f.target ? Math.min(f.target, f.a + d) : Math.max(f.target, f.a - d);
    if (f.a === f.target && f.res) { const r = f.res; f.res = null; r(); }
  }
  G.cine = lerp(G.cine, G.cineTarget, Math.min(1, dt * 5));
}

const TOAST_T = 4;
export function drawDialog() {
  const u = V.S, W = V.W, H = V.H;
  const cb0 = G.choiceBox;
  // while a choice is open, the question that led to it stays on screen
  const dlg = G.dlg || (cb0 && cb0.q ? { name: cb0.q.name, text: cb0.q.text, shown: 1e9, q: true } : null);
  if (dlg) {
    const bw = Math.min(V.VW - 16, 360) * u, bh = 52 * u;
    const bx = (W - bw) / 2, by = H - bh - 8 * u - safe.b * V.DPR;
    panel(bx, by, bw, bh);
    const pk = PORTRAITS[dlg.name];
    let tx = bx + 10 * u;
    const pc = pk && PORTRAIT[pk];
    if (pc) {
      const ph = 40 * u, pw = Math.min(46 * u, ph * pc.width / pc.height);
      D.save();
      D.fillStyle = 'rgba(255,240,200,0.07)'; rr(bx + 6 * u, by + 6 * u, 44 * u, ph, 2 * u); D.fill();
      D.strokeStyle = 'rgba(233,211,154,0.45)'; D.lineWidth = Math.max(1, u * 0.4); rr(bx + 6 * u, by + 6 * u, 44 * u, ph, 2 * u); D.stroke();
      D.beginPath(); rr(bx + 6 * u, by + 6 * u, 44 * u, ph, 2 * u); D.clip();
      D.imageSmoothingEnabled = false;
      D.drawImage(pc, bx + 6 * u + (44 * u - pw) / 2, by + 6 * u + 1 * u, pw, ph);
      D.restore();
      tx = bx + 56 * u;
    }
    if (dlg.name) {
      D.font = font(7 * u, 700);
      const nw = D.measureText(dlg.name).width + 14 * u;
      panel(bx + 8 * u, by - 9 * u, nw, 13 * u, { top: 'rgba(110,70,180,0.98)', bot: 'rgba(60,36,120,0.98)', r: 2 * u, noStuds: true });
      text(dlg.name, bx + 15 * u, by - 6.2 * u, 7 * u, UIC.gold, 'left', 700);
    }
    D.font = font(8 * u);
    if (dlg.q) { if (!cb0.q.lines || cb0.q.lw !== bw) { cb0.q.lines = wrap(dlg.text, bx + bw - 10 * u - tx); cb0.q.lw = bw; } dlg.lines = cb0.q.lines; dlg.lw = bw; }
    if (!dlg.lines || dlg.lw !== bw) { dlg.lines = wrap(dlg.text, bx + bw - 10 * u - tx); dlg.lw = bw; }
    let left = Math.floor(dlg.shown);
    for (let i = 0; i < dlg.lines.length && left > 0; i++) {
      const ln = dlg.lines[i], part = ln.slice(0, left);
      left -= ln.length + 1;
      text(part, tx, by + 8 * u + i * 11 * u, 8 * u);
    }
    if (!dlg.q && dlg.shown >= dlg.text.length && Math.floor(G.t * 3) % 2 === 0) {
      const ax = bx + bw - 12 * u, ay = by + bh - 10 * u;
      D.fillStyle = UIC.gold; D.beginPath(); D.moveTo(ax, ay); D.lineTo(ax + 6 * u, ay); D.lineTo(ax + 3 * u, ay + 4 * u); D.fill();
    }
  }
  const cb = G.choiceBox;
  if (cb) {
    D.font = font(8 * u, 600);
    let mw = 0;
    for (const o of cb.opts) mw = Math.max(mw, D.measureText(o).width);
    const bw = mw + 34 * u, rowH = 15 * u, bh = cb.opts.length * rowH + 10 * u;
    const bx = W - bw - 14 * u - safe.r * V.DPR, by = H - bh - 68 * u - safe.b * V.DPR;
    panel(bx, by, bw, bh);
    cb.opts.forEach((o, i) => {
      const y = by + 5 * u + i * rowH, sel = i === cb.sel;
      if (sel) { D.fillStyle = 'rgba(255,215,90,0.16)'; rr(bx + 4 * u, y, bw - 8 * u, rowH - u, 2 * u); D.fill(); }
      if (sel) { const ax = bx + 9 * u, ay = y + 4 * u + Math.sin(G.t * 8) * u * 0.6; D.fillStyle = UIC.gold; D.beginPath(); D.moveTo(ax, ay); D.lineTo(ax + 5 * u, ay + 3 * u); D.lineTo(ax, ay + 6 * u); D.fill(); }
      text(o, bx + 18 * u, y + 3 * u, 8 * u, sel ? UIC.gold : UIC.text, 'left', 600);
      hits.push({ x: bx, y, w: bw, h: rowH, fn: () => { if (!G.choiceBox) return; G.choiceBox.sel = i; pressed.a = true; G.choiceBox.t = 1; } });
    });
  }
  G.toasts.forEach((t, i) => {
    const a = Math.min(1, t.t * 4, (TOAST_T - t.t) * 3);
    D.globalAlpha = a;
    D.font = font(8 * u, 700);
    const w = D.measureText(t.str).width + 24 * u;
    // below the objective pill, never over it
    const y0 = G.mode === 'field' && G.objective ? 25 * u : 8 * u;
    const y = y0 + i * 19 * u + safe.t * V.DPR - (1 - a) * 6 * u;
    panel((W - w) / 2, y, w, 16 * u, { r: 8 * u, noStuds: true });
    text(t.str, W / 2, y + 3.5 * u, 8 * u, t.col, 'center', 700);
    D.globalAlpha = 1;
  });
}

export function drawCine() {
  if (G.cine < 0.01) return;
  const h = G.cine * 14 * V.S;
  D.fillStyle = '#05040c';
  D.fillRect(0, 0, V.W, h); D.fillRect(0, V.H - h, V.W, h);
}
export function drawFade() {
  if (G.fade.a <= 0.001) return;
  D.globalAlpha = G.fade.a; D.fillStyle = G.fade.col; D.fillRect(0, 0, V.W, V.H); D.globalAlpha = 1;
}

// speech bubble above an NPC (screen px)
export function drawBubble(x, y, ch) {
  const u = V.S;
  const w = 12 * u, h = 9 * u;
  D.fillStyle = 'rgba(255,250,235,0.95)'; rr(x - w / 2, y - h, w, h, 3 * u); D.fill();
  D.beginPath(); D.moveTo(x - 2 * u, y - 0.5); D.lineTo(x + 2 * u, y - 0.5); D.lineTo(x, y + 2.5 * u); D.fill();
  text(ch, x, y - h + 0.5 * u, 7 * u, ch === '!' ? '#d03a3a' : '#3a2a4a', 'center', 700, false);
}

// ---------- touch controls ----------
export function drawControls() {
  const k = V.DPR;
  if (stickVisible()) {
    const bx = (stick.active ? stick.bx : stick.hx) * k, by = (stick.active ? stick.by : stick.hy) * k, r = stick.r * k;
    D.globalAlpha = stick.active ? 0.9 : 0.45;
    D.fillStyle = 'rgba(20,12,40,0.45)'; D.beginPath(); D.arc(bx, by, r * 1.15, 0, TAU); D.fill();
    D.strokeStyle = 'rgba(255,240,210,0.55)'; D.lineWidth = 2 * k; D.beginPath(); D.arc(bx, by, r * 1.15, 0, TAU); D.stroke();
    D.fillStyle = 'rgba(255,240,210,0.5)';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, tx = bx + Math.cos(a) * r * 0.85, ty = by + Math.sin(a) * r * 0.85;
      D.save(); D.translate(tx, ty); D.rotate(a); D.beginPath(); D.moveTo(5 * k, 0); D.lineTo(-3 * k, -5 * k); D.lineTo(-3 * k, 5 * k); D.fill(); D.restore();
    }
    let kx = bx, ky = by;
    if (stick.active) {
      const dx = stick.x * k - bx, dy = stick.y * k - by, d = Math.hypot(dx, dy), m = Math.min(d, r);
      if (d > 0) { kx = bx + dx / d * m; ky = by + dy / d * m; }
    }
    const g = D.createRadialGradient(kx - 6 * k, ky - 6 * k, 2 * k, kx, ky, 24 * k);
    g.addColorStop(0, 'rgba(255,250,235,0.95)'); g.addColorStop(1, 'rgba(200,180,240,0.75)');
    D.fillStyle = g; D.beginPath(); D.arc(kx, ky, 22 * k, 0, TAU); D.fill();
    D.globalAlpha = 1;
  }
  if (touch.ui && G.mode === 'field') {
    for (const key of ['A', 'B', 'MENU']) {
      if (key !== 'MENU' && !buttonsVisible()) continue;
      if (key === 'MENU' && blocking()) continue;
      const b = btns[key], x = b.x * k, y = b.y * k, r = b.r * k;
      D.globalAlpha = b.down ? 0.95 : 0.6;
      const g = D.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      const base = key === 'A' ? ['#ffd970', '#e08a2a'] : key === 'B' ? ['#9ad0ff', '#4a6ad0'] : ['#d8c8ff', '#6a5aa8'];
      g.addColorStop(0, base[0]); g.addColorStop(1, base[1]);
      D.fillStyle = 'rgba(0,0,0,0.35)'; D.beginPath(); D.arc(x, y + 3 * k, r, 0, TAU); D.fill();
      D.fillStyle = g; D.beginPath(); D.arc(x, y + (b.down ? 2 * k : 0), r, 0, TAU); D.fill();
      D.strokeStyle = 'rgba(255,255,255,0.6)'; D.lineWidth = 1.5 * k; D.stroke();
      D.globalAlpha = 1;
      const lab = key === 'A' ? 'A' : key === 'B' ? 'B' : '☰';
      D.font = `700 ${Math.round(key === 'A' ? 26 * k : key === 'B' ? 20 * k : 16 * k)}px system-ui, sans-serif`; D.textAlign = 'center'; D.textBaseline = 'middle';
      D.fillStyle = 'rgba(40,20,10,0.85)'; D.fillText(lab, x, y + (b.down ? 2 * k : 0) + 1 * k);
      if (key === 'A' && G.hint) text(G.hint, x, y + r + 4 * k, 11 * k, UIC.text, 'center', 700);
      if (key === 'B') text('RUN', x, y + r + 4 * k, 10 * k, UIC.dim, 'center', 700);
    }
  }
}

export function drawRotate() {
  const W = V.W, H = V.H, k = V.DPR;
  D.fillStyle = '#0b0818'; D.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 - 30 * k;
  D.save(); D.translate(cx, cy); D.rotate(-Math.PI / 2 * smooth((Math.sin(performance.now() / 600) + 1) / 2));
  D.strokeStyle = UIC.gold; D.lineWidth = 4 * k; rr(-22 * k, -38 * k, 44 * k, 76 * k, 7 * k); D.stroke();
  D.fillStyle = UIC.gold; D.beginPath(); D.arc(0, 30 * k, 3 * k, 0, TAU); D.fill();
  D.restore();
  text('Please rotate your phone', cx, cy + 60 * k, 18 * k, UIC.text, 'center', 700);
  text('The Lantern Keeper plays in landscape', cx, cy + 86 * k, 13 * k, UIC.dim, 'center');
}

// ---------- pause menu ----------
export const menuActions = { toTitle: null, quality: null, qualityName: () => '' };
export function openMenu() { G.menuOpen = { sel: 0, t: 0 }; sfx('ok'); }
function menuItems() {
  return [
    { label: 'Resume', fn: () => { G.menuOpen = null; sfx('back'); } },
    { label: 'Sound: ' + (audio.muted ? 'Off' : 'On'), fn: () => { audio.setMuted(!audio.muted); sfx('ok'); } },
    { label: 'Graphics: ' + menuActions.qualityName(), fn: () => { menuActions.quality && menuActions.quality(); sfx('ok'); } },
    { label: 'Back to title', fn: () => { G.menuOpen = null; menuActions.toTitle && menuActions.toTitle(); } },
  ];
}
export function updateMenu() {
  if (!G.menuOpen) return;
  const items = menuItems();
  if (pressed.up) { G.menuOpen.sel = (G.menuOpen.sel + items.length - 1) % items.length; sfx('move'); }
  if (pressed.down) { G.menuOpen.sel = (G.menuOpen.sel + 1) % items.length; sfx('move'); }
  if (pressed.a) items[G.menuOpen.sel].fn();
  G.menuOpen && (G.menuOpen.t += 1 / 60);
  const outside = () => !(G.menuOpen.rects || []).some(([x, y, w, h]) => lastTap.x >= x && lastTap.x <= x + w && lastTap.y >= y && lastTap.y <= y + h);
  if (G.menuOpen && (pressed.b || pressed.menu || (pressed.tap && G.menuOpen.t > 0.1 && outside()))) { G.menuOpen = null; sfx('back'); }
  pressed.a = pressed.b = pressed.menu = pressed.tap = pressed.up = pressed.down = pressed.left = pressed.right = false;
}
export function drawMenu() {
  if (!G.menuOpen) return;
  const u = V.S, W = V.W, H = V.H;
  D.fillStyle = 'rgba(6,4,16,0.55)'; D.fillRect(0, 0, W, H);
  const pw = Math.min(200, V.VW * 0.48) * u, ph = 120 * u, px = W / 2 - pw - 6 * u, py = (H - ph) / 2;
  panel(px, py, pw, ph);
  text('PARTY', px + 10 * u, py + 8 * u, 8 * u, UIC.gold, 'left', 700);
  party.forEach((m, i) => {
    const y = py + 22 * u + i * 30 * u;
    if (!m.joined) return;
    const pc = PORTRAIT[m.id];
    D.imageSmoothingEnabled = false;
    if (pc) D.drawImage(pc, px + 8 * u, y - 1 * u, 24 * u * pc.width / pc.height, 24 * u);
    text(`${m.name}  Lv ${m.lv}`, px + 38 * u, y, 7.5 * u, UIC.text, 'left', 700);
    // label | bar | value on one line each, so nothing is drawn over a bar
    const lx = px + 38 * u, vx = px + pw - 8 * u, bx0 = lx + 12 * u, bw0 = vx - 30 * u - bx0;
    for (const [k, lab, v, mx, col, dy] of [[0, 'HP', m.hp, m.maxHp, '#7aeb8a', 10], [1, 'SP', m.sp, m.maxSp, '#7ac8ff', 18]]) {
      void k;
      text(lab, lx, y + dy * u, 5.5 * u, UIC.dim, 'left', 700, false);
      bar(bx0, y + (dy + 1.5) * u, bw0, 3 * u, v / mx, col);
      text(`${v}/${mx}`, vx, y + dy * u, 5.5 * u, UIC.text, 'right', 600, false);
    }
  });
  const itemsY = py + 22 * u + 2 * 30 * u;
  D.font = font(6 * u);
  const itemLines = wrap('Items: ' + (Object.entries(inventory).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k].name} ×${n}`).join(', ') || 'none'), pw - 20 * u);
  itemLines.slice(0, 2).forEach((l, i) => text(l, px + 10 * u, itemsY + i * 8 * u, 6 * u, UIC.dim));
  if (G.objective) {
    const gy = itemsY + Math.min(2, itemLines.length) * 8 * u + 3 * u;
    D.font = font(6.5 * u, 700);
    text('◆ ' + wrap(G.objective, pw - 24 * u)[0], px + 10 * u, gy, 6.5 * u, UIC.gold, 'left', 700);
  }
  const items = menuItems();
  const ow = Math.min(150, V.VW * 0.4) * u, oh = items.length * 17 * u + 12 * u, ox = W / 2 + 6 * u, oy = (H - oh) / 2;
  panel(ox, oy, ow, oh);
  G.menuOpen.rects = [[px, py, pw, ph], [ox, oy, ow, oh]];
  items.forEach((it, i) => {
    const y = oy + 6 * u + i * 17 * u, sel = i === G.menuOpen.sel;
    if (sel) { D.fillStyle = 'rgba(255,215,90,0.16)'; rr(ox + 4 * u, y, ow - 8 * u, 16 * u, 2 * u); D.fill(); }
    text(it.label, ox + 12 * u, y + 4 * u, 8 * u, sel ? UIC.gold : UIC.text, 'left', 600);
    hits.push({ x: ox, y, w: ow, h: 16 * u, fn: () => { G.menuOpen.sel = i; it.fn(); } });
  });
  text(touch.ui ? 'Drag on the left to walk · A talk / confirm · B run · tap outside to close' : 'Arrows/WASD move · Z talk / confirm · X back · Shift run · C menu',
    W / 2, py + ph + 6 * u, 6 * u, UIC.dim, 'center');
  text(touch.ui ? 'Battle: tap BOOST before a command to spend Boost Points' : 'Battle: E or R boost up · Q boost down (before choosing a command)',
    W / 2, py + ph + 15 * u, 6 * u, UIC.dim, 'center');
}

// ---------- title & ending ----------
export function drawTitle(cover = false) {
  const u = V.S, W = V.W, H = V.H, cx = W / 2, cy = H * 0.34;
  const g = D.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(6,4,18,0.6)'); g.addColorStop(0.5, 'rgba(6,4,18,0.08)'); g.addColorStop(1, 'rgba(6,4,18,0.55)');
  D.fillStyle = g; D.fillRect(0, 0, W, H);
  const a = Math.min(1, G.titleT / 1.5);
  D.globalAlpha = a;
  const gl = D.createRadialGradient(cx, cy, 0, cx, cy, 120 * u);
  gl.addColorStop(0, 'rgba(255,190,100,0.28)'); gl.addColorStop(1, 'rgba(255,190,100,0)');
  D.fillStyle = gl; D.fillRect(cx - 140 * u, cy - 120 * u, 280 * u, 240 * u);
  text('T H E', cx, cy - 32 * u, 8 * u, '#ffe6b0', 'center', 700);
  D.save();
  D.font = font(30 * u, 700); D.textAlign = 'center'; D.textBaseline = 'middle';
  D.lineWidth = 2.4 * u; D.strokeStyle = '#2a1030'; D.strokeText('Lantern Keeper', cx, cy);
  const lg = D.createLinearGradient(0, cy - 16 * u, 0, cy + 16 * u);
  lg.addColorStop(0, '#fffbe8'); lg.addColorStop(0.45, '#ffd56a'); lg.addColorStop(1, '#ff8a3a');
  D.shadowColor = 'rgba(255,170,80,0.9)'; D.shadowBlur = 14 * u;
  D.fillStyle = lg; D.fillText('Lantern Keeper', cx, cy);
  D.restore();
  D.strokeStyle = 'rgba(233,211,154,0.7)'; D.lineWidth = Math.max(1, u * 0.4);
  D.beginPath(); D.moveTo(cx - 70 * u, cy + 19 * u); D.lineTo(cx + 70 * u, cy + 19 * u); D.stroke();
  text('a very small adventure  ·  demo', cx, cy + 23 * u, 7.5 * u, '#d8c8ff', 'center', 600);
  if (!cover && G.titleT > 1 && Math.floor(G.titleT * 1.6) % 2 === 0) text(touch.ui ? 'Tap to begin' : 'Press Z or click to begin', cx, H * 0.74, 9 * u, UIC.text, 'center', 700);
  if (!cover) text('Pixels, music & sound generated in code · Made with Claude Code', cx, H - 12 * u - safe.b * V.DPR, 5.5 * u, 'rgba(216,200,255,0.65)', 'center', 500);
  D.globalAlpha = 1;
}
// End card: a compact plate in the lower-left corner so the relit plaza stays the picture.
export function drawEnding() {
  const u = V.S * 0.78, W = V.W, H = V.H;
  const a = Math.min(1, G.endingT / 2);
  D.globalAlpha = a;
  const vg = D.createLinearGradient(0, H * 0.55, 0, H); vg.addColorStop(0, 'rgba(6,4,18,0)'); vg.addColorStop(1, 'rgba(6,4,18,0.55)');
  D.fillStyle = vg; D.fillRect(0, 0, W, H);
  const lines = [
    G.flags.geraldFriend ? 'Gerald visits on Tuesdays. He brings lint.' : 'Gerald is still on the roof. Nobody knows how to ask him to leave.',
    `Battles won ${G.stats.wins}  ·  Breaks ${G.stats.breaks}  ·  Pip Lv ${party[0].lv}`,
  ];
  D.font = font(6 * u, 600);
  let tw = 0; for (const l of lines) tw = Math.max(tw, D.measureText(l).width);
  const pw = Math.min(Math.max(150 * u, tw + 20 * u), W - 24 * u), ph = 58 * u;
  const px = 12 * u + safe.l * V.DPR, py = H - ph - 8 * u - safe.b * V.DPR;
  panel(px, py, pw, ph, { r: 3 * u });
  const tx = px + 10 * u;
  text('THE LANTERN KEEPER', tx, py + 7 * u, 9 * u, UIC.gold, 'left', 700);
  text('Demo complete. Thanks for playing!', tx, py + 19 * u, 7 * u, UIC.text, 'left', 600);
  text(lines[0], tx, py + 30 * u, 6 * u, UIC.dim, 'left', 500);
  text(lines[1], tx, py + 39 * u, 6 * u, '#ffb8e0', 'left', 600);
  if (G.endingT > 3 && Math.floor(G.endingT * 1.6) % 2 === 0) text(touch.ui ? 'Tap to return to the title' : 'Press Z to return to the title', W - 14 * u - safe.r * V.DPR, H - 16 * u - safe.b * V.DPR, 7 * u, UIC.text, 'right', 700);
  D.globalAlpha = 1;
}

// current goal, top-left of the field view
export function drawObjective() {
  if (!G.objective) return;
  const u = V.S;
  D.font = font(6.5 * u, 700);
  const w = D.measureText(G.objective).width + 22 * u, h = 13 * u;
  const x = 8 * u + safe.l * V.DPR, y = 7 * u + safe.t * V.DPR;
  D.globalAlpha = 0.9;
  panel(x, y, w, h, { r: 6 * u, noStuds: true, top: 'rgba(30,24,60,0.82)', bot: 'rgba(12,10,30,0.82)', edge: 'rgba(233,211,154,0.7)' });
  D.fillStyle = UIC.gold; const dx = x + 8 * u, dy = y + h / 2;
  D.beginPath(); D.moveTo(dx, dy - 2.5 * u); D.lineTo(dx + 2.5 * u, dy); D.lineTo(dx, dy + 2.5 * u); D.lineTo(dx - 2.5 * u, dy); D.fill();
  text(G.objective, x + 14 * u, y + 3 * u, 6.5 * u, UIC.text, 'left', 700);
  D.globalAlpha = 1;
}
