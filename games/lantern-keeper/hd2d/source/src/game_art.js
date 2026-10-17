// Procedural pixel art ported from the original 2D Lantern Keeper (index.html): characters, portraits,
// Gerald / mothling / shrub battle sprites, field monsters, mushrooms, rocks, stumps, the broken lamp, icons.
// Every generator draws into a PB pixel buffer and returns canvases; game_tex.js turns them into textures.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi, s), hash2(xi + 1, yi, s), u), lerp(hash2(xi, yi + 1, s), hash2(xi + 1, yi + 1, s), u), v);
}
function fbm(x, y, s = 0, o = 4) {
  let t = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { t += a * vnoise(x * f, y * f, s + i * 17); n += a; a *= 0.5; f *= 2; }
  return t / n;
}

/* colours are [r,g,b] arrays */
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const css = (c, al = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;
const SHADOW_TINT = [46, 22, 92], LIGHT_TINT = [255, 244, 214];
const dk = (c, f = 0.68) => mixc(mulc(c, f), SHADOW_TINT, 0.16);
const lt = (c, f = 0.28) => mixc(c, LIGHT_TINT, f);

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return [c, x];
}

/* Pixel buffer used by every sprite generator */
class PB {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const i = (y * this.w + x) * 4;
    return this.d[i + 3] ? [this.d[i], this.d[i + 1], this.d[i + 2]] : null;
  }
  clear(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d[(y * this.w + x) * 4 + 3] = 0; }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, typeof c === 'function' ? c(i, j) : c); }
  /* filled ellipse; fn(nx, ny, x, y) returns a colour (normalised offsets in -1..1) */
  ell(cx, cy, rx, ry, fn) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) { const c = typeof fn === 'function' ? fn(nx, ny, x, y) : fn; if (c) this.set(x, y, c); }
      }
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), c);
  }
  /* selective outline: each empty pixel touching the sprite takes a dark version of its neighbour */
  outline(f = 0.32, diag = false) {
    const src = new Uint8ClampedArray(this.d);
    const at = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h) ? -1 : (src[(y * this.w + x) * 4 + 3] ? (y * this.w + x) * 4 : -1);
    const nb = diag ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] : [[0, 1], [1, 0], [-1, 0], [0, -1]];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (src[(y * this.w + x) * 4 + 3]) continue;
      for (const [dx, dy] of nb) {
        const j = at(x + dx, y + dy);
        if (j >= 0) { this.set(x, y, mixc(mulc([src[j], src[j + 1], src[j + 2]], f), [20, 10, 36], 0.45)); break; }
      }
    }
    return this;
  }
  flip() {
    const o = new PB(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4, j = (y * this.w + (this.w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) o.d[j + k] = this.d[i + k];
    }
    return o;
  }
  canvas() {
    const [c, x] = mk(this.w, this.h);
    x.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    return c;
  }
}

/* volumetric shading from a normal (light from top-left) */
function vol(base, nx, ny, hard = 0) {
  const s = nx * 0.55 + ny * 0.8;
  if (s > 0.62 - hard) return dk(base, 0.62);
  if (s > 0.22) return dk(base, 0.84);
  if (s < -0.62) return lt(base, 0.3);
  return base;
}
const OUT = [24, 14, 38];
const C = {
  skin: hex('#f2c29b'), skin2: hex('#d99a74'), skinDark: hex('#a8704e'),
  white: hex('#f4efe6'), black: hex('#231a2e'), eye: hex('#2a1a2e'), blush: hex('#ef8a8a'),
  wood: hex('#9a6a44'), woodD: hex('#6e4630'), woodL: hex('#c2915e'),
  stone: hex('#a7a3b0'), stoneD: hex('#7a7688'), glass: hex('#ffd98a'), glassHot: hex('#fff3c4'),
  iron: hex('#3a3446'), ironL: hex('#5e566e'),
};

/* ---------- characters (20x30, feet at y=28) ---------- */
const CH_W = 20, CH_H = 30, CH_OX = 10, CH_OY = 28;
function makeChar(o) {
  const dirs = { down: [], up: [], right: [], left: [] };
  const em = { down: [], up: [], right: [], left: [] };
  for (const dir of ['down', 'up', 'right']) {
    for (let f = 0; f < 3; f++) {
      const [pb, eb] = drawChar(o, dir, f);
      dirs[dir].push(pb.canvas());
      em[dir].push(eb ? eb.canvas() : null);
      if (dir === 'right') {
        dirs.left.push(pb.flip().canvas());
        em.left.push(eb ? eb.flip().canvas() : null);
      }
    }
  }
  return { frames: dirs, emis: em, ox: CH_OX, oy: CH_OY, w: CH_W, h: CH_H, portrait: makePortrait(o) };
}

function drawChar(o, dir, f, scale) {
  const pb = new PB(CH_W, CH_H);
  const eb = o.lantern ? new PB(CH_W, CH_H) : null;
  const Y = 4; /* head-room for hats */
  const skin = o.skin || C.skin, hair = o.hair || hex('#6b3e26'), shirt = o.shirt || hex('#4f7fd0');
  const pants = o.pants || hex('#3d3a5c'), shoes = o.shoes || hex('#5a3828');
  const step = f === 1 ? 1 : f === 2 ? -1 : 0;
  const bob = f === 0 ? 0 : 1;
  const side = dir === 'right';
  const back = dir === 'up';
  const by = Y + bob; /* body offset */

  /* legs & shoes */
  if (!o.noLegs) {
    if (side) {
      const front = step, l1 = 10 + front * 2, l2 = 10 - front * 2;
      for (const [lx, sh] of [[l2, true], [l1, false]]) {
        const pc = sh ? dk(pants, 0.8) : pants;
        pb.rect(lx - 1, by + 16 - bob, 2, 4 + bob, pc);
        pb.rect(lx - 1, by + 20, 3, 1, sh ? dk(shoes, 0.8) : shoes);
        pb.set(lx + 1, by + 19, sh ? dk(shoes, 0.8) : shoes);
      }
    } else {
      const lL = step > 0 ? 1 : step < 0 ? -1 : 0;
      pb.rect(7, by + 16, 2, 4 - lL - bob + 1, pants); pb.rect(6, by + 20 - lL, 3, 1, shoes);
      pb.rect(11, by + 16, 2, 4 + lL - bob + 1, dk(pants, 0.82)); pb.rect(11, by + 20 + lL, 3, 1, dk(shoes, 0.82));
    }
  }
  /* torso */
  const tw = side ? 6 : 8, tx = side ? 7 : 6;
  for (let y = 0; y < 6; y++) for (let x = 0; x < tw; x++) {
    let c = shirt;
    if (x === tw - 1 || y === 5) c = dk(shirt, 0.78);
    if (x === 0 && y < 4) c = lt(shirt, 0.18);
    pb.set(tx + x, by + 11 + y, c);
  }
  if (o.dress) {
    const dc = o.dress;
    for (let y = 0; y < 6; y++) {
      const half = (side ? 3 : 4) + Math.floor(y / 2);
      for (let x = -half; x < half; x++) pb.set(10 + x, by + 14 + y, x >= half - 2 ? dk(dc, 0.78) : x === -half ? lt(dc, 0.15) : dc);
    }
  }
  if (o.apron && !back) pb.rect(side ? 9 : 7, by + 13, side ? 3 : 6, o.dress ? 7 : 4, C.white);
  if (o.belt) pb.rect(tx, by + 15, tw, 1, o.belt);
  /* arms */
  const armC = o.sleeves === false ? skin : shirt;
  if (side) {
    const sw = step;
    pb.rect(9 + sw, by + 12, 2, 3, dk(armC, 0.9)); pb.set(9 + sw + (sw > 0 ? 1 : 0), by + 15, skin);
  } else {
    const sL = step > 0 ? 1 : 0, sR = step < 0 ? 1 : 0;
    pb.rect(5, by + 12, 1, 3 + sL, lt(armC, 0.08)); pb.set(5, by + 15 + sL, skin);
    pb.rect(14, by + 12, 1, 3 + sR, dk(armC, 0.8)); pb.set(14, by + 15 + sR, dk(skin, 0.85));
  }
  if (o.cape) {
    const cc = o.cape;
    if (back) pb.rect(5, by + 11, 10, 7, (x, y) => y === by + 17 ? dk(cc, 0.7) : x > 11 ? dk(cc, 0.82) : cc);
    else if (side) pb.rect(5, by + 11, 3, 7, dk(cc, 0.8));
  }
  /* scarf */
  if (o.scarf) {
    pb.rect(side ? 7 : 6, by + 10, side ? 6 : 8, 2, (x) => x > 11 ? dk(o.scarf, 0.8) : o.scarf);
    if (!back && !side) pb.rect(11, by + 12, 2, 3, dk(o.scarf, 0.85));
    if (side) pb.rect(5 - (f === 0 ? 0 : 1), by + 11, 2, 2 + (f === 0 ? 1 : 0), dk(o.scarf, 0.8));
    if (back) pb.rect(9, by + 12, 2, 4, dk(o.scarf, 0.82));
  }
  /* lantern held in the hand */
  if (o.lantern && dir !== 'up') {
    const lx = side ? 12 + step : 14, ly = by + 15 + (side ? 0 : (step < 0 ? 1 : 0));
    pb.set(lx, ly, C.iron); pb.rect(lx - 1, ly + 1, 3, 1, C.iron);
    pb.rect(lx - 1, ly + 2, 3, 3, C.glass); pb.set(lx, ly + 3, C.glassHot);
    pb.rect(lx - 1, ly + 5, 3, 1, C.iron);
    eb.rect(lx - 1, ly + 2, 3, 3, C.glass); eb.set(lx, ly + 3, C.glassHot);
  }
  /* head */
  const hcx = side ? 10.5 : 10, hcy = Y + 6 + bob * 0, hrx = 6.6, hry = 6.2;
  const headTop = Math.floor(hcy - hry);
  pb.ell(hcx, hcy + bob, hrx, hry, (nx, ny) => vol(skin, nx, ny));
  /* face */
  if (!back) {
    const ey = Math.round(hcy + 1 + bob);
    if (side) {
      if (!o.hideEyes) { pb.rect(13, ey, 1, 2, C.eye); }
      pb.set(15, ey + 2, dk(skin, 0.85));
      if (o.blush !== false) pb.set(12, ey + 2, C.blush);
    } else {
      if (!o.hideEyes) { pb.rect(7, ey, 1, 2, C.eye); pb.rect(12, ey, 1, 2, C.eye); }
      if (o.blush !== false) { pb.set(6, ey + 2, C.blush); pb.set(13, ey + 2, C.blush); }
    }
    if (o.glasses) {
      const gc = o.glasses;
      if (side) { pb.rect(12, ey - 1, 3, 1, gc); pb.set(12, ey + 2, gc); pb.set(14, ey + 2, gc); pb.set(14, ey, gc); }
      else { for (const gx of [6, 11]) { pb.rect(gx, ey - 1, 3, 1, gc); pb.rect(gx, ey + 2, 3, 1, gc); pb.set(gx, ey, gc); pb.set(gx, ey + 1, gc); pb.set(gx + 2, ey, gc); pb.set(gx + 2, ey + 1, gc); } pb.set(9, ey, gc); pb.set(10, ey, gc); }
    }
    if (o.mustache) {
      const mc = o.mustache;
      if (side) pb.rect(13, ey + 3, 3, 1, mc);
      else { pb.rect(7, ey + 3, 6, 1, mc); pb.set(6, ey + 4, mc); pb.set(13, ey + 4, mc); }
    }
    if (o.beard) {
      const bc = o.beard;
      if (side) pb.ell(12.5, ey + 4.5, 3.5, 3, (nx, ny) => vol(bc, nx, ny));
      else pb.ell(10, ey + 4.5, 5.2, 3.6, (nx, ny) => ny < -0.5 && Math.abs(nx) < 0.4 ? null : vol(bc, nx, ny));
    }
  }
  /* hair */
  const hs = o.hairStyle || 'short';
  if (hs !== 'none') {
    pb.ell(hcx, hcy + bob, hrx + 0.4, hry + 0.4, (nx, ny, x, y) => {
      const ry = y - Y - bob; /* row relative to head */
      let on = false;
      if (back) on = hs === 'bald' ? (ry > 3 && ry < 8) : (ry < (hs === 'long' ? 13 : 10));
      else if (side) {
        if (hs === 'bald') on = ry > 4 && ry < 8 && x < 7;
        else on = ry < 4 || (ry < 5 && x % 2 === 0) || x < 9 - (ry > 8 ? 1 : 0) || (hs === 'long' && x < 11 && ry < 13);
        if (hs === 'fringe') on = on || (ry < 6 && x > 10);
      } else {
        if (hs === 'bald') on = (x < 6 || x > 13) && ry > 2 && ry < 8;
        else if (hs === 'fringe') on = ry < 3 || (x < 12 && ry < 8 - (x > 9 ? 1 : 0)) || (ry < 4 + (x % 2)) || x < 5 || x > 14 && ry < 9;
        else if (hs === 'spiky') on = ry < 4 + ((x * 7) % 3 === 0 ? 1 : 0) || x < 5 && ry < 9 || x > 14 && ry < 9;
        else on = ry < 3 + ((x % 3) === 0 ? 1 : 0) || (x < 5 && ry < (hs === 'long' ? 13 : 8)) || (x > 14 && ry < (hs === 'long' ? 13 : 8));
      }
      return on ? vol(hair, nx, ny, 0.1) : null;
    });
    if (hs === 'long' && !side) {
      pb.rect(3, by + 7, 2, 7, (x, y) => vol(hair, -0.5, (y - by - 10) / 5));
      pb.rect(15, by + 7, 2, 7, (x, y) => dk(hair, 0.8));
    }
    if (hs === 'bun') pb.ell(10, Y + 0 + bob, 3, 2.4, (nx, ny) => vol(hair, nx, ny));
    if (hs === 'spiky') for (const sx of [5, 8, 11, 14]) { pb.set(sx, headTop - 1 + bob, hair); pb.set(sx + 1, headTop - 2 + bob, lt(hair)); }
  }
  /* hats */
  const hat = o.hat, hc = o.hatColor || hex('#d04848');
  if (hat === 'beanie') {
    pb.ell(hcx, hcy - 3 + bob, hrx + 0.6, 4.6, (nx, ny) => ny < 0.5 ? vol(hc, nx, ny) : null);
    pb.rect(side ? 4 : 3, Y + 3 + bob, side ? 14 : 14, 2, (x) => x > 13 ? dk(lt(hc, 0.35), 0.85) : lt(hc, 0.35));
    const px = side ? 7 : 10;
    pb.ell(px, Y - 3 + bob + (side ? 1 : 0), 2.2, 2.2, (nx, ny) => vol(hex('#fff1d0'), nx, ny));
  } else if (hat === 'tophat') {
    pb.rect(7, Y - 3 + bob, 6, 5, (x, y) => x === 12 ? dk(hc, 0.75) : x === 7 ? lt(hc, 0.2) : hc);
    pb.rect(7, Y + 0 + bob, 6, 1, hex('#c8a24a'));
    pb.rect(5, Y + 2 + bob, 10, 1, dk(hc, 0.85));
  } else if (hat === 'witch') {
    for (let y = 0; y < 8; y++) { const half = Math.floor(y * 0.7) + 1; pb.rect(10 - half + (side ? 1 : 0), Y - 4 + y + bob, half * 2, 1, (x) => x > 10 ? dk(hc, 0.75) : hc); }
    pb.set(12, Y - 5 + bob, hc); pb.set(13, Y - 5 + bob, dk(hc, 0.8));
    pb.rect(2, Y + 3 + bob, 16, 2, (x) => x > 12 ? dk(hc, 0.7) : dk(hc, 0.9));
    pb.rect(7, Y + 2 + bob, 6, 1, hex('#e8c24a'));
  } else if (hat === 'cap') {
    pb.ell(hcx, hcy - 2.5 + bob, hrx + 0.3, 4.5, (nx, ny) => ny < 0.5 ? vol(hc, nx, ny) : null);
    if (side) pb.rect(13, Y + 3 + bob, 5, 1, dk(hc, 0.8));
    else if (!back) pb.rect(5, Y + 4 + bob, 10, 1, dk(hc, 0.8));
  } else if (hat === 'chef') {
    pb.ell(10, Y - 1 + bob, 6, 4, (nx, ny) => vol(C.white, nx, ny));
    pb.rect(5, Y + 2 + bob, 10, 2, (x) => x > 12 ? dk(C.white, 0.85) : C.white);
  } else if (hat === 'helmet') {
    pb.ell(hcx, hcy - 2 + bob, hrx + 0.8, 5, (nx, ny) => ny < 0.5 ? vol(hc, nx, ny, 0.1) : null);
    pb.rect(3, Y + 4 + bob, 14, 1, dk(hc, 0.75));
    pb.set(10, Y - 1 + bob, hex('#e04a4a')); pb.set(10, Y - 2 + bob, hex('#e04a4a'));
  } else if (hat === 'hood') {
    pb.ell(hcx, hcy + bob, hrx + 1.2, hry + 1, (nx, ny, x, y) => {
      const inner = ((x + 0.5 - hcx) / (hrx - 1.2)) ** 2 + ((y + 0.5 - hcy - bob - 1.5) / (hry - 1.2)) ** 2 < 1;
      if (!back && inner && !side) return null;
      if (side && x > 10 && inner) return null;
      return vol(hc, nx, ny, 0.05);
    });
  }
  if (o.bow) { pb.set(14, Y + 1 + bob, o.bow); pb.set(15, Y + bob, o.bow); pb.set(15, Y + 2 + bob, o.bow); }
  pb.outline();
  if (eb) eb.d.forEach((v, i) => { if ((i & 3) === 3 && v && !pb.d[i]) eb.d[i] = 0; });
  return [pb, eb];
}

/* larger head-and-shoulders portrait for dialogue */
function makePortrait(o) {
  const [pb] = drawChar(Object.assign({}, o, { lantern: false }), 'down', 0);
  const cvs = pb.canvas();
  const [c, x] = mk(20, 18);
  x.drawImage(cvs, 0, -1);
  return c;
}

/* animals & special sprites */
function makeDog(col) {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const pb = new PB(22, 18);
    const b = col, by = 9;
    pb.ell(11, by + 2, 6.5, 3.6, (nx, ny) => vol(b, nx, ny));
    for (const [lx, o2] of [[6, f], [9, 1 - f], [13, f], [16, 1 - f]]) pb.rect(lx, by + 4, 2, 3 - o2, dk(b, lx > 10 ? 0.75 : 0.9));
    pb.ell(5, by - 1, 4.2, 3.8, (nx, ny) => vol(b, nx, ny));
    pb.rect(1, by, 3, 2, lt(b, 0.25)); pb.set(0, by, C.black);
    pb.set(4, by - 2, C.eye);
    pb.rect(6, by - 4, 3, 5, dk(hex('#7a4a2a'), 0.9));
    const tw = f ? -1 : 1;
    pb.line(17, by, 20, by - 3 + tw, lt(b, 0.1)); pb.line(17, by + 1, 19, by - 2 + tw, b);
    pb.set(2, by + 3, hex('#e06a7a'));
    pb.outline();
    out.push(pb.canvas());
  }
  return out;
}
function makeCat(col) {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const pb = new PB(16, 18);
    pb.ell(8, 12, 4.5, 4.5, (nx, ny) => vol(col, nx, ny));
    pb.ell(8, 6, 4, 3.6, (nx, ny) => vol(col, nx, ny));
    pb.set(5, 2, col); pb.set(5, 1, col); pb.set(11, 2, dk(col)); pb.set(11, 1, dk(col)); pb.set(6, 2, col); pb.set(10, 2, dk(col));
    pb.rect(6, 6, 1, 1, hex('#e8d24a')); pb.rect(10, 6, 1, 1, hex('#e8d24a'));
    pb.set(8, 7, hex('#e07a8a'));
    const tx = f ? 1 : 0;
    pb.line(12, 15, 14 + tx, 11, dk(col, 0.85)); pb.line(14 + tx, 11, 14 + tx, 8 + tx, dk(col, 0.85));
    pb.outline();
    out.push(pb.canvas());
  }
  return out;
}
/* Grandpa lying flat on his porch mat */
function makeLyingGrandpa() {
  const pb = new PB(32, 16);
  pb.rect(1, 9, 30, 5, (x, y) => (x + y) % 4 === 0 ? hex('#a64a4a') : hex('#c25e52'));
  pb.rect(1, 13, 30, 1, hex('#7a3434'));
  pb.ell(7, 7, 5.5, 5, (nx, ny) => vol(C.skin, nx, ny));
  pb.ell(5, 7, 3, 4, (nx, ny) => nx < 0 ? vol(hex('#e8e4ea'), nx, ny) : null);
  pb.ell(9.5, 10, 3, 2.6, (nx, ny) => vol(hex('#eeeaf2'), nx, ny));
  pb.rect(8, 5, 1, 2, C.eye); pb.rect(8, 8, 1, 1, C.eye);
  pb.rect(12, 5, 13, 6, (x, y) => y === 10 ? dk(hex('#6a8a5a')) : x > 20 ? hex('#5d7d4f') : hex('#6a8a5a'));
  pb.rect(24, 6, 6, 4, (x, y) => y > 7 ? hex('#4a3a5a') : hex('#5a4a6a'));
  pb.rect(29, 5, 2, 3, hex('#5a3828'));
  pb.rect(15, 4, 4, 2, C.skin);
  pb.outline();
  return pb.canvas();
}
function makeRock(seed, s = 1) {
  const r = rng(seed), w = Math.round(14 * s), h = Math.round(10 * s), pb = new PB(w + 2, h + 2);
  const base = mixc(C.stone, hex('#8a9a8a'), r() * 0.5);
  pb.ell(w / 2 + 1, h / 2 + 2, w / 2, h / 2, (nx, ny) => ny < -0.1 && hash2(nx * 9 | 0, 1, seed) > 0.8 ? null : vol(base, nx, ny));
  if (r() < 0.6) for (let i = 0; i < 4 * s; i++) pb.set(w / 2 - 3 + r() * 6, 3 + r() * 3, hex('#5a8a4a'));
  pb.outline(0.4);
  return { c: pb.canvas(), ox: Math.round(w / 2 + 1), oy: h + 1, w: w + 2, h: h + 2 };
}
function makeMushrooms(seed, glow = true) {
  const r = rng(seed), pb = new PB(16, 12), eb = new PB(16, 12);
  const col = glow ? pick([hex('#6ae8ff'), hex('#b48aff'), hex('#7affc0')]) : hex('#d04a4a');
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = 3 + r() * 10, h = 3 + r() * 4, cr = 2 + r() * 1.5;
    pb.rect(Math.round(x), Math.round(11 - h), 1, Math.round(h), hex('#e8e0d0'));
    pb.ell(x + 0.5, 11 - h, cr, cr * 0.7, (nx, ny) => ny > 0.3 ? null : vol(col, nx, ny));
    if (glow) eb.ell(x + 0.5, 11 - h, cr, cr * 0.7, (nx, ny) => ny > 0.3 ? null : col);
  }
  pb.outline(0.4);
  return { c: pb.canvas(), e: glow ? eb.canvas() : null, ox: 8, oy: 11, w: 16, h: 12, col };
}
function makeStump(seed) {
  const pb = new PB(18, 14);
  pb.rect(2, 4, 14, 8, (x) => vol(C.wood, (x - 9) / 7, 0));
  pb.ell(9, 4, 7, 2.6, (nx, ny) => Math.hypot(nx, ny) % 0.4 < 0.15 ? dk(C.woodL, 0.85) : C.woodL);
  pb.rect(0, 10, 4, 2, C.wood); pb.rect(14, 10, 4, 2, dk(C.wood));
  pb.outline(0.4);
  return { c: pb.canvas(), ox: 9, oy: 12, w: 18, h: 14 };
}
function makeBush(seed, col) {
  const r = rng(seed), pb = new PB(24, 16);
  const leaf = col || mixc(hex('#3e8a40'), hex('#5a9a3a'), r());
  const blobs = [[12, 9, 8], [7, 10, 5.5], [17, 10, 5.5], [11, 6, 5]];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
    let bn = null, best = -1;
    for (const [bx, by, br] of blobs) { const dx = (x + 0.5 - bx) / br, dy = (y + 0.5 - by) / br, d = dx * dx + dy * dy; if (d < 1 && 1 - d > best) { best = 1 - d; bn = [dx, dy]; } }
    if (!bn) continue;
    const s = bn[0] * 0.5 + bn[1] * 0.8 + (hash2(x, y, seed) - 0.5) * 0.4;
    pb.set(x, y, s > 0.55 ? dk(leaf, 0.6) : s > 0.15 ? dk(leaf, 0.82) : s < -0.5 ? lt(leaf, 0.3) : leaf);
  }
  if (r() < 0.5) for (let i = 0; i < 4; i++) pb.set(5 + r() * 14, 4 + r() * 8, pick([hex('#ff7a8a'), hex('#ffe070'), hex('#ffffff')]));
  pb.outline(0.35);
  return { c: pb.canvas(), ox: 12, oy: 15, w: 24, h: 16 };
}
function makeGate(open) {
  /* a north-south barrier across the east road: striped boom between two posts */
  const PW = 12, PH = 50, pb = new PB(PW, PH);
  const base = PH - 2;
  const post = (y0, h) => pb.rect(3, y0, 6, h, (x, y) => y === y0 ? C.woodL : x > 6 ? dk(C.wood) : C.wood);
  post(2, 14); post(base - 14, 14);
  pb.rect(2, 1, 8, 2, dk(C.wood)); pb.rect(2, base - 15, 8, 2, dk(C.wood));
  if (!open) {
    for (let y = 14; y < base - 12; y++) {
      const stripe = Math.floor(y / 4) % 2;
      pb.rect(4, y, 4, 1, (x) => stripe ? (x > 6 ? dk(hex('#e04a3a')) : hex('#e04a3a')) : (x > 6 ? dk(C.white, 0.85) : C.white));
    }
    pb.rect(2, 20, 8, 1, C.iron); pb.rect(2, base - 18, 8, 1, C.iron);
  }
  pb.outline(0.4);
  return { c: pb.canvas(), ox: 6, oy: base, w: PW, h: PH };
}
function makeOldLamp() {
  /* a crooked, broken lamp-post in the clearing where Gerald roosts */
  const pb = new PB(26, 52);
  const b = 50;
  pb.rect(9, b - 3, 8, 3, C.stoneD);
  for (let y = 0; y < 38; y++) { const x = 12 + Math.round(Math.sin(y / 14) * 2 + (y > 30 ? (y - 30) * 0.4 : 0)); pb.set(x, b - 4 - y, C.iron); pb.set(x - 1, b - 4 - y, C.ironL); }
  pb.rect(12, 6, 10, 2, C.iron);
  pb.rect(17, 8, 7, 7, hex('#4a4058')); pb.rect(18, 9, 2, 3, hex('#6a6080'));
  pb.outline(0.5);
  return { c: pb.canvas(), ox: 13, oy: b, w: 26, h: 52 };
}
function makeFlowerPatch(seed) {
  const r = rng(seed), pb = new PB(20, 12);
  const col = pick([hex('#ff6a8a'), hex('#ffd24a'), hex('#a88aff'), hex('#ffffff'), hex('#ff9a4a')]);
  for (let i = 0; i < 9; i++) {
    const x = Math.round(2 + r() * 16), y = Math.round(3 + r() * 7);
    pb.set(x, y + 1, hex('#3a7a34')); pb.set(x, y, col); pb.set(x - 1, y, dk(col, 0.85)); pb.set(x + 1, y, lt(col)); pb.set(x, y - 1, lt(col));
  }
  return { c: pb.canvas(), ox: 10, oy: 11, w: 20, h: 12 };
}
function makeMailbox() {
  const pb = new PB(10, 20);
  pb.rect(4, 8, 2, 11, C.wood);
  pb.rect(1, 2, 8, 6, (x, y) => y === 2 ? lt(hex('#3a6ab8')) : x > 6 ? dk(hex('#3a6ab8')) : hex('#3a6ab8'));
  pb.rect(8, 1, 1, 4, hex('#e04a4a'));
  pb.outline(0.4);
  return { c: pb.canvas(), ox: 5, oy: 19, w: 10, h: 20 };
}

/* ---------- enemies (battle sprites) ---------- */
function makeShrub() {
  const frames = [];
  for (let f = 0; f < 2; f++) {
    const pb = new PB(40, 36);
    const leaf = hex('#4f9a42'), b = 34 - f;
    const blobs = [[20, b - 13, 13], [11, b - 9, 8], [29, b - 9, 8], [17, b - 22, 8], [25, b - 20, 7]];
    for (let y = 0; y < 36; y++) for (let x = 0; x < 40; x++) {
      let bn = null, best = -1;
      for (const [bx, by, br] of blobs) { const dx = (x + 0.5 - bx) / br, dy = (y + 0.5 - by) / br, d = dx * dx + dy * dy; if (d < 1 && 1 - d > best) { best = 1 - d; bn = [dx, dy]; } }
      if (!bn) continue;
      if (best < 0.1 && hash2(x, y, 8) > 0.5) continue;
      const s = bn[0] * 0.5 + bn[1] * 0.8 + (hash2(x >> 1, y >> 1, 3) - 0.5) * 0.45;
      pb.set(x, y, s > 0.55 ? dk(leaf, 0.55) : s > 0.15 ? dk(leaf, 0.8) : s < -0.5 ? lt(leaf, 0.32) : leaf);
    }
    /* the smug face: half-lidded eyes, one raised eyebrow, a smirk */
    const fy = b - 16;
    for (const ex of [14, 24]) {
      pb.rect(ex, fy, 5, 4, C.white); pb.rect(ex + 2, fy + 2, 2, 2, C.eye);
      pb.rect(ex, fy, 5, 2, dk(leaf, 0.7));
    }
    pb.line(13, fy - 3, 19, fy - 2, hex('#2a3a1a'));
    pb.line(23, fy - 5, 29, fy - 3, hex('#2a3a1a'));
    pb.line(17, fy + 7, 24, fy + 7, hex('#2a1a1a')); pb.line(24, fy + 7, 26, fy + 5, hex('#2a1a1a'));
    pb.rect(16, b - 1, 8, 2, hex('#6a4a30'));
    pb.outline(0.35);
    frames.push(pb.canvas());
  }
  return { frames, w: 40, h: 36 };
}
function makeMoth(big) {
  const frames = [], efr = [];
  const sc = big ? 2 : 1;
  const W2 = big ? 96 : 44, H2 = big ? 84 : 40;
  for (let f = 0; f < 3; f++) {
    const pb = new PB(W2, H2), eb = new PB(W2, H2);
    const cx = W2 / 2, cy = H2 * 0.5;
    const wingC = big ? hex('#b89a7a') : hex('#c8b08a'), wingD = big ? hex('#8a6a5a') : hex('#9a8060');
    const flap = [0, 0.18, -0.12][f];
    /* wings: two lobes per side */
    for (const side of [-1, 1]) {
      const lobes = [[13, -4, 13, 10], [10, 8, 9, 8]];
      for (const [ox, oy, rx, ry] of lobes) {
        const wx = cx + side * ox * sc, wy = cy + (oy - flap * 14 * (oy < 0 ? 1 : 0.4)) * sc;
        pb.ell(wx, wy, rx * sc * (1 - Math.abs(flap) * 0.5), ry * sc, (nx, ny, x, y) => {
          const d = Math.hypot(nx, ny);
          let c = mixc(wingC, wingD, d * 0.7);
          if (d > 0.82) c = dk(wingD, 0.8);
          if (Math.abs(d - 0.55) < 0.07) c = lt(wingC, 0.25);
          if ((nx * side > 0.1) && Math.hypot(nx * side - 0.25, ny + 0.1) < 0.24 && oy < 0) c = Math.hypot(nx * side - 0.25, ny + 0.1) < 0.12 ? hex('#2a1a3a') : hex('#f0a040');
          if (hash2(x, y, 5) > 0.93) c = dk(c, 0.85);
          return c;
        });
      }
    }
    /* fuzzy body */
    pb.ell(cx, cy + 4 * sc, 5 * sc, 11 * sc, (nx, ny, x, y) => {
      let c = vol(hex('#e8dcc8'), nx, ny);
      if (Math.floor(y / (2 * sc)) % 3 === 0 && ny > 0) c = dk(c, 0.85);
      return c;
    });
    /* fluffy collar */
    pb.ell(cx, cy - 4 * sc, 8 * sc, 5 * sc, (nx, ny, x, y) => (hash2(x, y, 2) > 0.8 && Math.hypot(nx, ny) > 0.8) ? null : vol(hex('#fbf6ea'), nx, ny));
    /* head and big shiny eyes */
    pb.ell(cx, cy - 9 * sc, 6 * sc, 5 * sc, (nx, ny) => vol(hex('#efe4d2'), nx, ny));
    for (const side of [-1, 1]) {
      pb.ell(cx + side * 3.4 * sc, cy - 9.5 * sc, 2.6 * sc, 3 * sc, (nx, ny) => (nx < -0.2 && ny < -0.2) ? C.white : hex('#1e1630'));
      /* feathery antennae */
      for (let i = 0; i < 9 * sc; i++) {
        const ax = cx + side * (2 + i * 0.7) * 1, ay = cy - 14 * sc - i * 0.9;
        pb.set(ax, ay, hex('#8a6a4a'));
        if (i % 2 === 0) { pb.set(ax + side, ay - 1, hex('#a88a6a')); pb.set(ax - side, ay - 1, hex('#a88a6a')); }
      }
    }
    if (big) {
      /* Gerald: tiny bowtie and a glowing tummy full of stolen flame */
      pb.rect(cx - 5, cy - 1, 4, 4, hex('#d03a5a')); pb.rect(cx + 1, cy - 1, 4, 4, hex('#d03a5a')); pb.rect(cx - 1, cy, 2, 2, hex('#ff6a8a'));
      pb.ell(cx, cy + 10, 6, 7, (nx, ny) => mixc(hex('#ffe08a'), hex('#ff8a3a'), Math.hypot(nx, ny)));
      eb.ell(cx, cy + 10, 6, 7, (nx, ny) => mixc(hex('#fff0b0'), hex('#ff8a3a'), Math.hypot(nx, ny)));
    }
    pb.outline(0.35);
    frames.push(pb.canvas());
    efr.push(big ? eb.canvas() : null);
  }
  return { frames, emis: efr, w: W2, h: H2 };
}

/* weakness icons, 7x7 */
const ICONS = {};
function makeIcons() {
  const draw = (name, fn) => { const pb = new PB(9, 9); fn(pb); pb.outline(0.3); ICONS[name] = pb.canvas(); };
  draw('broom', pb => { pb.line(6, 1, 3, 5, C.woodL); pb.rect(1, 5, 4, 3, hex('#e8c860')); pb.set(1, 7, hex('#b8983a')); pb.set(3, 7, hex('#b8983a')); });
  draw('sling', pb => { pb.line(2, 1, 4, 4, C.wood); pb.line(6, 1, 4, 4, C.wood); pb.rect(4, 4, 1, 4, C.wood); pb.set(4, 2, hex('#a8a8b8')); });
  draw('fire', pb => { pb.ell(4.5, 5.5, 3, 3, hex('#ff7a2a')); pb.set(4, 2, hex('#ff7a2a')); pb.set(5, 1, hex('#ffb04a')); pb.ell(4.5, 6, 1.5, 1.6, hex('#ffe08a')); });
  draw('sass', pb => { pb.ell(4.5, 4, 3.5, 3, C.white); pb.set(2, 7, C.white); pb.set(3, 6, C.white); pb.rect(3, 4, 1, 1, C.black); pb.rect(5, 4, 1, 1, C.black); pb.set(7, 4, C.black); });
  draw('q', pb => { pb.rect(1, 1, 7, 7, hex('#3a3450')); pb.rect(3, 2, 3, 1, C.white); pb.set(6, 3, C.white); pb.set(5, 4, C.white); pb.set(4, 5, C.white); pb.set(4, 7, C.white); });
}
function makeFieldShrub() {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const b = makeBush(77, hex('#4f9a42'));
    const [c, x] = mk(24, 17);
    x.drawImage(b.c, 0, f);
    x.fillStyle = '#fff'; x.fillRect(7, 6 + f, 3, 2); x.fillRect(13, 6 + f, 3, 2);
    x.fillStyle = '#2a1a2e'; x.fillRect(8, 7 + f, 2, 1); x.fillRect(14, 7 + f, 2, 1);
    x.fillStyle = '#2a3a1a'; x.fillRect(6, 4 + f, 4, 1); x.fillRect(13, 3 + f, 4, 1);
    x.fillRect(10, 10 + f, 4, 1); x.fillRect(14, 9 + f, 1, 1);
    out.push(c);
  }
  return out;
}
function makeFieldMoth() {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const pb = new PB(22, 18);
    const wing = hex('#c8b08a');
    for (const s of [-1, 1]) {
      pb.ell(11 + s * 5, 7 - f * 2, 5 - f, 4 + f, (nx, ny) => Math.hypot(nx, ny) > 0.75 ? dk(wing, 0.75) : (Math.hypot(nx * s - 0.2, ny) < 0.3 ? hex('#f0a040') : wing));
      pb.ell(11 + s * 4, 12, 3, 2.5, (nx, ny) => dk(wing, 0.88));
    }
    pb.ell(11, 10, 2.5, 5, (nx, ny) => vol(hex('#efe4d2'), nx, ny));
    pb.set(10, 7, C.eye); pb.set(12, 7, C.eye);
    pb.set(9, 3, hex('#8a6a4a')); pb.set(13, 3, hex('#8a6a4a')); pb.set(8, 2, hex('#8a6a4a')); pb.set(14, 2, hex('#8a6a4a'));
    pb.outline(0.35);
    out.push(pb.canvas());
  }
  return out;
}

/* =====================================================================================
   HD pixel creatures and props, drawn natively at the 3D scene's texel density (~42 px/m for
   characters, ~56 px/m for props) in the same style as Pip / Moss: hard 1-texel dark outlines
   around every part (so overlapping parts read with inner contour lines), 4-6 tone ramps lit from
   the top-left, 2x2 ordered dither only on the band edges, no smooth gradients.
   ===================================================================================== */
const INK = hex('#1b1222');
const ramp = (...h) => h.map(hex);
// lightness 0..1 -> ramp index, dithering a narrow band between tones
let DITHER = true;      // off for the moths: their wings read cleaner (and match the cast) as flat bands
function rampAt(R, s, x, y, dither = true) {
  const v = clamp(s, 0, 0.999) * R.length, i = Math.floor(v), f = v - i;
  let k = i;
  if (!dither || !DITHER) return R[k];
  if (f > 0.72 && i < R.length - 1 && ((x + y) & 1) === 0) k = i + 1;
  else if (f < 0.28 && i > 0 && ((x + y) & 1) === 1) k = i - 1;
  return R[k];
}
// lambert on an ellipsoid normal (nx, ny in -1..1), light from top-left-front
function lam(nx, ny, amb = 0.18) {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const d = -0.48 * nx - 0.62 * ny + 0.62 * nz;
  return clamp(amb + (1 - amb) * Math.max(0, d) * 1.08, 0, 1);
}
// A drawing layer: parts are masks drawn back-to-front; each part paints a 1-texel ink ring first
// (over whatever is behind it), then its fill, so every part keeps a crisp contour.
class Sheet extends PB {
  constructor(w, h) { super(w, h); this.mask = new Uint8Array(w * h); }
  part(x0, y0, x1, y1, inside, color, o = {}) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(this.w - 1, Math.ceil(x1)); y1 = Math.min(this.h - 1, Math.ceil(y1));
    const W = x1 - x0 + 1, H = y1 - y0 + 1, m = new Array(W * H);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[(y - y0) * W + (x - x0)] = inside(x + 0.5, y + 0.5) || null;
    const at = (x, y) => (x < x0 || y < y0 || x > x1 || y > y1) ? null : m[(y - y0) * W + (x - x0)];
    const ink = o.ink === undefined ? INK : o.ink;
    if (ink) for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (at(x, y)) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) || (o.diag && (at(x - 1, y - 1) || at(x + 1, y + 1) || at(x + 1, y - 1) || at(x - 1, y + 1)))) {
        if (o.inkOnlyOver && !this.get(x, y)) continue;
        this.set(x, y, typeof ink === 'function' ? ink(x, y) : ink);
        if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.mask[y * this.w + x] = 1;
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const info = at(x, y); if (!info) continue;
      const c = color(x, y, info); if (!c) continue;
      this.set(x, y, c); this.mask[y * this.w + x] = 1;
    }
    return this;
  }
  // ellipse part (optionally rotated by `rot`), info = { nx, ny, r }
  ellPart(cx, cy, rx, ry, color, o = {}) {
    const rot = o.rot || 0, cs = Math.cos(rot), sn = Math.sin(rot), edge = o.edge;
    const R = Math.max(rx, ry) * 1.35 + 2;
    return this.part(cx - R, cy - R, cx + R, cy + R, (x, y) => {
      const dx = x - cx, dy = y - cy;
      const u = (dx * cs + dy * sn) / rx, v = (-dx * sn + dy * cs) / ry;
      const r = Math.hypot(u, v), lim = edge ? edge(Math.atan2(v, u), u, v) : 1;
      return r <= lim ? { nx: dx / rx, ny: dy / ry, u, v, r: r / lim } : null;
    }, color, o);
  }
  // thick pixel stroke along points (no ink)
  stroke(pts, c, w = 1) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let k = 0; k <= n; k++) { const x = lerp(ax, bx, k / n), y = lerp(ay, by, k / n); for (let a = 0; a < w; a++) for (let b = 0; b < w; b++) this.set(Math.round(x - (w - 1) / 2 + a), Math.round(y - (w - 1) / 2 + b), typeof c === 'function' ? c(x, y, k / n) : c); }
    }
  }
  // ink ring round the whole silhouette
  outlineOuter() {
    const src = new Uint8ClampedArray(this.d);
    const a = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[(y * this.w + x) * 4 + 3] > 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) this.set(x, y, INK);
    return this;
  }
  // ink outline on the silhouette of everything drawn so far (cleans single-pixel gaps)
  seal() {
    const src = new Uint8ClampedArray(this.d);
    const a = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[(y * this.w + x) * 4 + 3] > 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (a(x, y)) continue;
      if (a(x - 1, y) && a(x + 1, y) || a(x, y - 1) && a(x, y + 1)) this.set(x, y, INK);
    }
    return this;
  }
}
const mirrorX = (pb) => { const o = new Sheet(pb.w, pb.h); o.d = pb.flip().d; return o; };

/* ---------- Gerald and the Lil' Mothlings ---------- */
// big: Gerald (176x156, emissive tummy). small: mothling (64x58).
function makeMothPX(big) {
  const W = big ? 186 : 70, H = big ? 156 : 58;
  const u = big ? 1.55 : 0.56;                    // feature scale
  const frames = [], emis = [];
  // Gerald: deep plum-to-apricot wings with real darks so he holds strong value contrast under the
  // moon; the mothlings: dusky violet wings (mid values, not washed-out cream) with warm eyespots
  const FORE = big ? ramp('#1a0c1c', '#44203c', '#7a3658', '#ac5a72', '#d88c8c', '#f6c49c') : ramp('#140f26', '#2e2450', '#4e3c7a', '#765aa0', '#a080be', '#d0b4dc');
  const HIND = big ? ramp('#1c0c22', '#4a1e46', '#80325e', '#b45a7a', '#e0909a') : ramp('#16112a', '#33285a', '#56427e', '#7e649c', '#a68ab6');
  DITHER = false;
  const FUR = ramp('#3e3046', '#6e5c6c', '#a29096', '#cdbfba', '#ebe1d6', '#fffaf0');
  const EYE = ramp('#0e0a1c', '#1d1838', '#33306a', '#5a5aa6');
  const ANT = ramp('#3a2630', '#6e4a40', '#a07858', '#c8a47a');
  const RED = ramp('#4a1026', '#8e2038', '#cf3a4c', '#ff7a7a');
  const GLOW = ramp('#a8461a', '#e8762a', '#ffae3a', '#ffd86a', '#fff4b8');
  for (let f = 0; f < 3; f++) {
    const pb = new Sheet(W, H), eb = new PB(W, H);
    const cx = W / 2, bob = [0, -1, 1][f] * (big ? 2 : 1);
    const cy = H * 0.545 + bob;
    const flap = [0, 0.32, -0.22][f];
    // --- wings (behind the body) ---
    for (const side of [-1, 1]) {
      // hindwing: rounded, hangs down and out
      const hx = cx + side * 26 * u, hy = cy + 22 * u - flap * 10 * u;
      pb.ellPart(hx, hy, 30 * u, 22 * u * (1 - Math.abs(flap) * 0.35), (x, y, i) => {
        let s = 0.62 - i.r * 0.38 + (i.u * side) * 0.08 - i.v * 0.1;
        if (i.r > 0.82) s -= 0.22;                                            // dark fringe
        if (Math.abs(i.r - 0.6) < 0.05 * (big ? 1 : 2)) s += 0.25;           // pale band
        if (big && i.r < 0.86 && Math.abs(Math.sin(Math.atan2(i.v, i.u * side) * 4.5)) < 0.06) s -= 0.18; // veins
        return rampAt(HIND, s, x, y);
      }, { rot: side * (0.55 + flap * 0.6), edge: (a) => 1 - 0.05 * Math.max(0, Math.sin(a * 7)) });
      // forewing: long, raked up and out, scalloped trailing edge, eyespot
      const fx = cx + side * 28 * u, fy = cy - 8 * u - flap * 22 * u;
      pb.ellPart(fx, fy, 32 * u, 25 * u * (1 - Math.abs(flap) * 0.45), (x, y, i) => {
        const uu = i.u * side;
        let s = 0.7 - i.r * 0.35 + uu * 0.12 - i.v * 0.12;
        if (i.r > 0.84) s -= 0.3;
        else if (Math.abs(i.r - 0.66) < (big ? 0.035 : 0.07)) s += 0.28;
        if (big && i.r < 0.84 && i.r > 0.18 && Math.abs(Math.sin(Math.atan2(i.v, uu) * 5)) < 0.055) s -= 0.2;
        if (big && hash2(x >> 1, y >> 1, 5) > 0.9 && i.r < 0.8) s -= 0.12;
        // eyespot
        const e = Math.hypot(uu - 0.2, i.v + 0.05) * (big ? 1 : 0.8);
        if (e < 0.34) {
          if (e < 0.1) return (uu - 0.2 < -0.03 && i.v + 0.05 < -0.03) ? FUR[5] : EYE[0];
          if (e < 0.17) return e < 0.135 ? GLOW[2] : GLOW[1];
          if (e < 0.22) return FORE[5];
          if (e < 0.27) return FORE[1];
        }
        return rampAt(FORE, s, x, y);
      }, { rot: side * (-0.42 + flap * 0.9), edge: (a, uu, v) => 1 - (v > 0 ? 0.07 * Math.abs(Math.sin(a * 6)) : 0) });
    }
    // --- legs (dangling, behind the abdomen) ---
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      const lx = cx + side * (4 + k * 3) * u, ly = cy + (8 + k * 3) * u;
      const kx = lx + side * (6 + k) * u, ky = ly + (7 + k * 2) * u, ex = kx + side * 1 * u, ey = ky + 8 * u;
      if (big) { pb.stroke([[lx, ly], [kx, ky], [ex, ey]], INK, 3); pb.stroke([[lx, ly], [kx, ky], [ex, ey]], ANT[1], 1); }
      else pb.stroke([[lx, ly], [kx, ky], [ex, ey]], INK, 1);
    }
    // --- abdomen: fuzzy, segmented ---
    pb.ellPart(cx, cy + 16 * u, 14 * u, 22 * u, (x, y, i) => {
      let s = lam(i.nx, i.ny * 0.8);
      const seg = Math.floor((y - cy) / (5 * u + 0.5));
      if (((y - cy) % Math.max(2, Math.round(5 * u))) === 0 && i.ny > -0.2) s -= 0.2;
      if (hash2(x, y, 3) > 0.86) s += 0.1;
      return rampAt(FUR, s * 0.92 + 0.04 + (seg % 2) * 0.03, x, y);
    });
    if (big) {
      // the stolen flame glowing through the tummy
      pb.ellPart(cx, cy + 22 * u, 9 * u, 11.5 * u, (x, y, i) => {
        const g = 1 - i.r + (hash2(x >> 1, y >> 1, 21) - 0.5) * 0.18 - i.ny * 0.1;
        const c = rampAt(GLOW, 0.15 + g * 0.95, x, y);
        eb.set(x, y, c);
        return c;
      }, { ink: hex('#6a2a1a') });
    }
    // --- fur collar / thorax ---
    pb.ellPart(cx, cy - 1 * u, 17 * u, 12 * u, (x, y, i) => {
      let s = lam(i.nx, i.ny) + 0.12;
      const t = Math.atan2(i.ny, i.nx);
      if (Math.abs(Math.sin(t * 7 + i.r * 6)) < 0.18 && i.r > 0.45) s -= 0.2;    // fur clumps
      if (hash2(x, y, 7) > 0.88) s += 0.12;
      return rampAt(FUR, s, x, y);
    }, { edge: (a) => 1 + 0.12 * Math.abs(Math.sin(a * 6.5)) - (big ? 0.0 : 0.04) });
    if (big) {
      // bowtie
      for (const side of [-1, 1]) pb.ellPart(cx + side * 5.5 * u, cy + 6 * u, 5.5 * u, 4 * u, (x, y, i) => rampAt(RED, lam(i.nx * side * 0.6, i.ny) + (Math.abs(i.v) < 0.25 && i.u * side > 0.3 ? -0.2 : 0), x, y), { edge: (a, uu, v) => 0.75 + 0.35 * Math.abs(uu * side) });
      pb.ellPart(cx, cy + 6 * u, 2.6 * u, 2.6 * u, (x, y, i) => rampAt(RED, lam(i.nx, i.ny) + 0.2, x, y));
    }
    // --- head ---
    const hy = cy - 15 * u;
    // antennae (feathered combs), drawn before the head so they tuck behind it
    for (const side of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([cx + side * (4 + t * 15 + t * t * 6) * u, hy - (6 + t * 20 - t * t * 4) * u]); }
      if (big) {
        for (let k = 1; k < pts.length; k++) {
          const [px, py] = pts[k], len = (1 - Math.abs(k - 6) / 7) * 6 * u;
          pb.stroke([[px, py], [px + side * len * 0.5, py - len]], INK, 3);
          pb.stroke([[px, py], [px - side * len * 0.2, py - len * 0.9]], INK, 3);
        }
        for (let k = 1; k < pts.length; k++) {
          const [px, py] = pts[k], len = (1 - Math.abs(k - 6) / 7) * 6 * u;
          pb.stroke([[px, py], [px + side * len * 0.5, py - len]], ANT[3], 1);
          pb.stroke([[px, py], [px - side * len * 0.2, py - len * 0.9]], ANT[2], 1);
        }
        pb.stroke(pts, INK, 3); pb.stroke(pts, ANT[1], 1);
      } else {
        pb.stroke(pts, INK, 1);
        const [ex, ey] = pts[pts.length - 1]; pb.set(ex + side, ey - 1, INK); pb.set(ex, ey - 1, ANT[2]);
      }
    }
    pb.ellPart(cx, hy, 13 * u, 11 * u, (x, y, i) => {
      let s = lam(i.nx, i.ny) + 0.18;
      if (hash2(x, y, 9) > 0.9) s -= 0.1;
      return rampAt(FUR, s, x, y);
    }, { edge: (a) => 1 + (Math.sin(a) < -0.3 ? 0.08 * Math.abs(Math.sin(a * 5)) : 0) });
    // big glossy eyes
    for (const side of [-1, 1]) {
      const ex = cx + side * 6.2 * u, ey = hy + 0.5 * u;
      pb.ellPart(ex, ey, 5.2 * u + (big ? 0 : 0.4), 6 * u + (big ? 0 : 0.4), (x, y, i) => {
        if (i.nx < -0.05 && i.nx > -0.65 && i.ny < -0.1 && i.ny > -0.75) return FUR[5];        // main glint
        if (big && i.nx > 0.2 && i.nx < 0.5 && i.ny > 0.35 && i.ny < 0.6) return EYE[3];       // reflected bounce
        return rampAt(EYE, 0.55 - i.ny * 0.35 - i.r * 0.25, x, y);
      }, { ink: big ? INK : null });
    }
    if (big) {
      // a small happy mouth and blush
      const my = Math.round(hy + 7 * u);
      pb.stroke([[cx - 3, my - 1], [cx - 1, my + 1], [cx + 1, my + 1], [cx + 3, my - 1]], INK, 1);
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) pb.set(cx + side * (9 * u + k), hy + 5.5 * u + (k & 1), RED[3]);
    } else {
      pb.set(cx, hy + 3, INK);
    }
    frames.push(pb.canvas());
    emis.push(big ? eb.canvas() : null);
  }
  DITHER = true;
  return { frames, emis, w: W, h: H };
}

/* ---------- the Smug Shrub ---------- */
function makeShrubPX() {
  const W = 74, H = 66, frames = [];
  const LEAF = ramp('#0e2416', '#173c20', '#22562a', '#337434', '#4f923a', '#7cb244', '#b4d264');
  const BARK = ramp('#2a1a18', '#4e3226', '#76503a', '#9c7452');
  const R = rng(4242);
  const clumps = [];
  // back row first, then front: [x, y, r]
  for (const [x, y, r] of [[22, 22, 12], [52, 21, 12], [37, 14, 14], [14, 36, 12], [60, 36, 12], [28, 31, 15], [47, 31, 15], [37, 44, 17], [19, 47, 10], [56, 47, 10]]) clumps.push([x, y, r, R()]);
  for (let f = 0; f < 2; f++) {
    const pb = new Sheet(W, H);
    const bob = f, sq = f ? 1 : 0;
    // little root feet + twig arms
    for (const side of [-1, 1]) {
      pb.ellPart(37 + side * 9, 61, 5, 3, (x, y, i) => rampAt(BARK, lam(i.nx, i.ny) + 0.1, x, y));
      const ax = 37 + side * 25, ay = 44 + bob;
      pb.stroke([[ax, ay], [ax + side * 7, ay + 3 - f * 2], [ax + side * 10, ay - 1 - f * 2]], INK, 3);
      pb.stroke([[ax + side * 7, ay + 3 - f * 2], [ax + side * 9, ay + 6 - f]], INK, 3);
      pb.stroke([[ax, ay], [ax + side * 7, ay + 3 - f * 2], [ax + side * 10, ay - 1 - f * 2]], BARK[2], 1);
      pb.stroke([[ax + side * 7, ay + 3 - f * 2], [ax + side * 9, ay + 6 - f]], BARK[1], 1);
    }
    for (const [x, y, r, seed] of clumps) {
      pb.ellPart(x, y + bob + (y < 25 ? sq : 0), r, r * 0.9, (px, py, i) => {
        let s = lam(i.nx * 0.9, i.ny * 0.9, 0.12);
        // leaf-shaped highlight marks and dark gaps, quantised to 2x2 cells
        const h = hash2(px >> 1, py >> 1, (seed * 999) | 0);
        if (h > 0.84 && s > 0.45) s += 0.18;
        else if (h < 0.12) s -= 0.2;
        if (hash2(px, py, 77) > 0.94 && i.ny < 0.2) s += 0.25;
        return rampAt(LEAF, s * 0.95 + 0.04, px, py);
      }, { edge: (a) => 1 - 0.09 * Math.abs(Math.sin(a * 5 + seed * 6)) });
    }
    // the smug face: half-lidded eyes, one raised brow, a smirk
    const fy = 33 + bob;
    for (const [ex, side] of [[29, -1], [45, 1]]) {
      pb.part(ex - 5, fy - 3, ex + 5, fy + 3, (x, y) => { const dx = (x - ex) / 5, dy = (y - fy) / 3.6; return dx * dx + dy * dy <= 1 && y > fy - 1 ? 1 : null; },
        (x, y) => (Math.abs(x - 0.5 - (ex + 1.5)) < 1.5 && y > fy) ? INK : (y < fy + 1.5 ? hex('#cfd2c8') : hex('#f4f2e6')));
      pb.stroke([[ex - 5, fy - 1], [ex + 5, fy - 1]], LEAF[1], 1);                       // heavy lid
      pb.set(ex + 1, fy + 1, hex('#fffff4'));
      if (side < 0) pb.stroke([[ex - 6, fy - 5], [ex + 4, fy - 4]], INK, 2);              // flat brow
      else pb.stroke([[ex - 4, fy - 6 - f], [ex + 1, fy - 8 - f], [ex + 6, fy - 6 - f]], INK, 2);   // raised brow
    }
    pb.stroke([[31, fy + 9], [40, fy + 9], [44, fy + 7]], INK, 2);                         // smirk
    pb.set(44, fy + 6, INK);
    pb.seal();
    frames.push(pb.canvas());
  }
  return { frames, w: W, h: H };
}

/* ---------- forest dressing at 56 px/m ---------- */
const STONE = ramp('#141420', '#262836', '#3c3e4a', '#58585e', '#7a7874', '#a8a294');
const MOSS = ramp('#1a3420', '#28502c', '#3c6e36', '#5a9044', '#84b254');
function makeBoulderPX(seed, w, h) {
  const R = rng(seed), pb = new Sheet(w, h);
  const lumps = [];
  const n = 2 + Math.floor(R() * 3);
  for (let k = 0; k < n; k++) {
    const rx = w * (0.22 + R() * 0.16), ry = h * (0.3 + R() * 0.25);
    const x = rx + 1 + R() * (w - 2 * rx - 2), y = h - 2 - ry * (0.75 + R() * 0.2);
    lumps.push([x, y, rx, ry]);
  }
  lumps.sort((a, b) => (a[1] - a[3]) - (b[1] - b[3]));
  const mossTop = R() < 0.75;
  for (const [x, y, rx, ry] of lumps) {
    pb.ellPart(x, y, rx, ry, (px, py, i) => {
      // faceted: quantise the normal so the stone reads as planes, not a smooth blob
      const qx = Math.round(i.nx * 2.2) / 2.2, qy = Math.round(i.ny * 2.2) / 2.2;
      let s = lam(qx, qy, 0.08) * 0.95;
      if (hash2(px >> 1, py >> 1, seed) > 0.9) s -= 0.1;
      if (hash2(px, py, seed + 3) > 0.95) s += 0.12;
      if (mossTop && i.ny < -0.45 + (hash2(px >> 1, 0, seed) - 0.5) * 0.3) return rampAt(MOSS, s + 0.1, px, py, false);
      return rampAt(STONE, s, px, py, false);
    }, { edge: (a, u, v) => v > 0.55 ? 1.25 : 1, ink: null });   // flat-ish base
  }
  pb.outlineOuter();
  // cracks
  for (let k = 0; k < 2; k++) {
    let x = w * (0.3 + R() * 0.4), y = h * (0.35 + R() * 0.2);
    for (let i = 0; i < h * 0.3; i++) { if (pb.get(x | 0, y | 0)) pb.set(x, y, STONE[1]); x += R() - 0.5; y += 1; }
  }
  pb.seal();
  return pb.canvas();
}
function makeStumpPX(sc = 1, mossy = false) {
  const W = Math.round(48 * sc), H = Math.round(38 * sc), pb = new Sheet(W, H);
  const BARK = ramp('#22161a', '#3e2a24', '#5e4030', '#82603e', '#a88456');
  const RING = ramp('#5a3e2a', '#8a6640', '#b48e5a', '#dcb880');
  const S = (v) => v * sc, cx = W / 2, by = H - 3 * sc;
  // roots
  for (const [x, w] of [[-17, 8], [17, 8], [-8, 6], [8, 6]]) pb.ellPart(cx + S(x), by + S(1), S(w), S(3.5), (px, py, i) => rampAt(BARK, lam(i.nx, i.ny) * 0.9, px, py));
  const top = S(10), hw = S(14);
  pb.part(cx - hw - S(3), top, cx + hw + S(3), by + S(1), (x, y) => {
    const flare = y > by - S(6) ? (y - (by - S(6))) * 0.6 : 0;
    return Math.abs(x - cx) < hw + flare ? 1 : null;
  }, (x, y) => {
    const t = (x - cx) / hw;
    let s = lam(clamp(t, -1, 1) * 0.95, 0.15) * 0.85 + 0.06;
    const groove = Math.round((x - cx) / Math.max(2, S(3.2)) + Math.sin(y * 0.3) * 0.4);
    if ((x - cx) / Math.max(2, S(3.2)) + Math.sin(y * 0.3) * 0.4 - groove > 0.3) s -= 0.2;
    if (mossy && y < top + S(9) + hash2(x >> 1, 0, 3) * S(6)) return rampAt(MOSS, s + 0.12, x, y);
    return rampAt(BARK, s, x, y);
  });
  pb.ellPart(cx, top, hw, S(4.6), (x, y, i) => {
    const ring = Math.round(i.r * (3 + sc * 2));
    if (i.r > 0.86) return BARK[3];
    return RING[ring % 2 ? 1 : (i.nx < 0 && i.ny < 0 ? 3 : 2)];
  });
  if (mossy) for (let k = 0; k < 18 * sc; k++) { const a = hash2(k, 3, 9) * Math.PI * 2; pb.set(cx + Math.cos(a) * hw * 0.9, top + Math.sin(a) * S(4), MOSS[2 + (k % 3)]); }
  pb.seal();
  return pb.canvas();
}
function makeMushPX(seed) {
  const R = rng(seed), W = 30, H = 24, pb = new Sheet(W, H), eb = new PB(W, H);
  const pal = [ramp('#13506a', '#1f86a8', '#3ac8e6', '#9af4ff', '#e8ffff'), ramp('#3a2a7a', '#6046b4', '#9a76f0', '#cab0ff', '#f4ecff'), ramp('#12583e', '#20946a', '#3ad49a', '#9cf8cc', '#eafff4')][Math.floor(R() * 3)];
  const STEM = ramp('#6a6278', '#a29aa8', '#d4ccce', '#f2ece4');
  const n = 2 + Math.floor(R() * 3), caps = [];
  for (let i = 0; i < n; i++) caps.push([5 + R() * 20, 5 + R() * 9, 3 + R() * 3]);
  caps.sort((a, b) => a[1] - b[1]);
  for (const [x, hgt, r] of caps) {
    const top = H - 2 - hgt;
    pb.part(x - 1.2, top, x + 1.2, H - 1, (px, py) => Math.abs(px - x) < 1.3 ? 1 : null, (px, py) => STEM[px < x ? 2 : 1]);
    pb.ellPart(x, top, r, r * 0.7, (px, py, i) => {
      if (i.ny > 0.35) return null;
      const c = (hash2(px, py, seed) > 0.86 && i.ny < 0) ? pal[4] : rampAt(pal, lam(i.nx, i.ny) * 0.9 + 0.15, px, py);
      eb.set(px, py, c);
      return c;
    });
  }
  pb.seal();
  return { c: pb.canvas(), e: eb.canvas(), col: pal[2] };
}
function makeOldLampPX() {
  // a crooked, broken iron lamp-post (2.2 m at ~56 px/m), its cage bent and glass cracked
  const W = 64, H = 124, pb = new Sheet(W, H);
  const IRON = ramp('#141220', '#262236', '#3c3650', '#5a526e', '#7e7690');
  const MOSSY = ramp('#1a3420', '#2e5a30', '#4c843e');
  const base = H - 2;
  pb.part(20, base - 8, 44, base, () => 1, (x, y) => rampAt(STONE, 0.75 - (y - base + 8) * 0.06 - (x > 38 ? 0.2 : 0), x, y));
  pb.part(23, base - 13, 41, base - 8, () => 1, (x, y) => rampAt(STONE, 0.6 - (x > 37 ? 0.2 : 0), x, y));
  // bent pole
  const pole = [];
  for (let k = 0; k <= 30; k++) { const t = k / 30; pole.push([32 + Math.sin(t * 2.2) * 5 + t * t * 10, base - 13 - t * 92]); }
  pb.stroke(pole, INK, 6);
  pb.stroke(pole.map(([x, y]) => [x - 1, y]), (x, y) => IRON[2], 3);
  pb.stroke(pole.map(([x, y]) => [x - 2, y]), IRON[3], 1);
  // moss creeping up
  for (let k = 0; k < 40; k++) { const t = Math.pow(k / 40, 1.5) * 0.5, [x, y] = pole[Math.round(t * 30)]; pb.set(x - 2 + (hash2(k, 1, 4) * 5 | 0), y + (hash2(k, 2, 4) * 4 | 0), MOSSY[k % 3]); }
  // arm and the hanging cage, tipped over
  const [tx, ty] = pole[30];
  pb.stroke([[tx, ty], [tx - 16, ty + 3]], INK, 4); pb.stroke([[tx, ty], [tx - 16, ty + 3]], IRON[3], 2);
  pb.part(tx - 26, ty + 4, tx - 10, ty + 24, (x, y) => { const dx = x - (tx - 18) - (y - ty - 4) * 0.25; return Math.abs(dx) < 6 - (y > ty + 20 ? 2 : 0) ? 1 : null; }, (x, y) => {
    const dx = x - (tx - 18) - (y - ty - 4) * 0.25;
    if (Math.abs(dx) > 4.2 || (y - ty) % 7 === 4) return IRON[x < tx - 18 ? 3 : 2];
    return hash2(x, y, 5) > 0.7 ? hex('#3e4a5e') : hex('#28303e');                 // dark, cracked glass
  });
  pb.seal();
  return pb.canvas();
}


/* ---------- village side characters at Pip's scale (40x66, ~42 px/m, big chibi head) ---------- */
const SKIN = ramp('#5e2e2a', '#a8644e', '#dc9a76', '#f2bf98', '#ffe0c0');
const shades = (h) => { const b = hex(h); return [mixc(mulc(b, 0.35), [24, 12, 40], 0.3), mixc(mulc(b, 0.62), [40, 20, 60], 0.18), b, lt(b, 0.25), lt(b, 0.5)]; };
function makeChibiPX(o, dir) {
  const W = 40, H = 66, pb = new Sheet(W, H);
  const side = dir === 'right', back = dir === 'up';
  const SH = shades(o.shirt), PA = shades(o.pants), HA = shades(o.hair), BO = shades(o.boots || '#4a3024');
  const HT = o.hatColor ? shades(o.hatColor) : null;
  const hx = side ? 21 : 20, hy = 24;
  // legs + boots
  const legs = side ? [[18, 1], [22, 0]] : [[16, 0], [24, 0]];
  for (const [lx, far] of legs) {
    pb.part(lx - 3, 50, lx + 3, 60, (x, y) => Math.abs(x - lx) < 3 ? 1 : null, (x, y) => rampAt(PA, (x < lx ? 0.62 : 0.4) - far * 0.2, x, y));
    pb.part(lx - 4 + (side ? 1 : 0), 58, lx + 4 + (side ? 2 : 0), 64, (x, y) => (Math.abs(x - lx - (side ? 1 : 0)) < 4 && y < 64) ? 1 : null, (x, y) => rampAt(BO, (y < 60 ? 0.72 : 0.45) - far * 0.2, x, y));
  }
  // arm behind (side view)
  if (side) pb.ellPart(16, 44, 3, 6, (x, y, i) => rampAt(SH, lam(i.nx, i.ny) * 0.7, x, y));
  // torso
  const tw = side ? 7 : 8;
  pb.part(hx - tw - 1, 35, hx + tw + 1, 53, (x, y) => {
    const k = (y - 35) / 18, half = tw - (k < 0.15 ? 2 : 0) + (k > 0.85 ? 1 : 0);
    return Math.abs(x + 0.5 - hx) < half ? 1 : null;
  }, (x, y) => {
    let s = lam((x - hx) / tw * 0.9, (y - 44) / 12) + 0.08;
    if (o.belt && y === 49) return hex(o.belt);
    if (o.braces && !side && !back && (x === hx - 4 || x === hx + 3)) return rampAt(shades(o.braces), s, x, y);
    if (o.vest && !back && Math.abs(x + 0.5 - hx) > 2 && !side) return rampAt(shades(o.vest), s, x, y);
    return rampAt(SH, s, x, y);
  });
  if (!side) {
    for (const sx of [-1, 1]) {
      pb.ellPart(hx + sx * (tw + 2), 43, 2.6, 6.5, (x, y, i) => rampAt(SH, lam(i.nx, i.ny) * 0.9 + 0.05, x, y));
      pb.ellPart(hx + sx * (tw + 2), 50, 2.5, 2.3, (x, y, i) => rampAt(SKIN, lam(i.nx, i.ny) + 0.1, x, y));
    }
  } else {
    pb.ellPart(22, 43, 3, 7, (x, y, i) => rampAt(SH, lam(i.nx, i.ny) + 0.05, x, y));
    pb.ellPart(23, 50, 2.5, 2.3, (x, y, i) => rampAt(SKIN, lam(i.nx, i.ny) + 0.1, x, y));
  }
  // back hair (behind the head)
  if (o.hairStyle !== 'bald') pb.ellPart(hx - (side ? 2 : 0), hy - 1, 15, 14, (x, y, i) => rampAt(HA, lam(i.nx, i.ny) * 0.8, x, y), { edge: (a) => 1 - 0.06 * Math.abs(Math.sin(a * 6)) });
  else pb.ellPart(hx - (side ? 3 : 0), hy + 1, 13, 9, (x, y, i) => i.ny > -0.2 ? rampAt(HA, lam(i.nx, i.ny) + 0.1, x, y) : null);
  // head
  if (!back || o.hairStyle === 'bald') pb.ellPart(hx, hy, 14, 13, (x, y, i) => rampAt(SKIN, lam(i.nx, i.ny) + 0.12, x, y));
  if (back) {
    if (o.hairStyle !== 'bald') pb.ellPart(hx, hy, 14.5, 13.5, (x, y, i) => {
      let s = lam(i.nx, i.ny) * 0.85 + 0.08;
      if (Math.abs(Math.sin(x * 0.9 + y * 0.2)) < 0.25) s -= 0.15;
      return rampAt(HA, s, x, y);
    }, { edge: (a) => 1 - 0.06 * Math.abs(Math.sin(a * 7)) });
    else pb.ellPart(hx, hy + 3, 12.5, 7, (x, y, i) => i.ny > -0.4 ? rampAt(HA, lam(i.nx, i.ny) + 0.1, x, y) : null, { ink: null });
  } else {
    // ears
    if (!side) for (const sx of [-1, 1]) { pb.set(hx + sx * 13, hy + 2, SKIN[2]); pb.set(hx + sx * 13, hy + 3, SKIN[1]); }
    else pb.ellPart(hx - 3, hy + 2, 2, 2.5, (x, y, i) => rampAt(SKIN, lam(i.nx, i.ny), x, y));
    // fringe / side hair
    if (o.hairStyle !== 'bald' && !o.hat) pb.ellPart(hx - (side ? 3 : 0), hy - 4, 13.5, 9.5, (x, y, i) => {
      if (y > hy - 3 && (side ? (x > hx - 3) : true)) { const jag = (x * 7 % 5); if (y > hy - 3 + jag * 0.5 || y > hy - 1) return null; }
      return rampAt(HA, lam(i.nx, i.ny) + 0.1 - ((x + y) % 4 === 0 ? 0.15 : 0), x, y);
    }, { inkOnlyOver: true });
    else for (const sx of [-1, 1]) if (!side || sx < 0) pb.ellPart(hx + sx * 10, hy + 1, 3.5, 4.5, (x, y, i) => rampAt(HA, lam(i.nx, i.ny) + 0.2, x, y));
    // face
    const eyes = side ? [hx + 7] : [hx - 6, hx + 4];
    for (const ex of eyes) {
      pb.rect(ex, hy + 2, 3, 4, hex('#24182e'));
      pb.set(ex, hy + 2, hex('#fffaf0')); pb.set(ex + 2, hy + 5, hex('#5a4a8a'));
      if (o.glasses) { pb.stroke([[ex - 2, hy], [ex + 3, hy], [ex + 3, hy + 5], [ex - 2, hy + 5], [ex - 2, hy]], hex(o.glasses), 1); }
    }
    if (o.glasses && !side) pb.stroke([[hx - 2, hy + 1], [hx + 1, hy + 1]], hex(o.glasses), 1);
    if (!side) { pb.set(hx - 8, hy + 6, hex('#ef8a8a')); pb.set(hx - 7, hy + 6, hex('#ef8a8a')); pb.set(hx + 7, hy + 6, hex('#ef8a8a')); pb.set(hx + 8, hy + 6, hex('#ef8a8a')); }
    if (side) { pb.set(hx + 12, hy + 4, SKIN[3]); pb.set(hx + 12, hy + 5, SKIN[2]); pb.set(hx + 12, hy + 3, INK); }
    if (o.beard) {
      const BE = shades(o.beard);
      pb.ellPart(hx + (side ? 5 : 0), hy + 10, side ? 6 : 9, 5.5, (x, y, i) => i.ny < -0.25 ? null : rampAt(BE, lam(i.nx, i.ny) + 0.15 - ((x * 3 + y) % 5 === 0 ? 0.15 : 0), x, y));
    }
    if (o.mustache) {
      const MU = shades(o.mustache);
      pb.part(hx - 6 + (side ? 7 : 0), hy + 8, hx + 6 + (side ? 4 : 0), hy + 10, (x, y) => {
        const dx = x - (side ? hx + 9 : hx); return Math.abs(dx) < (side ? 3 : 5) - (y > hy + 9.5 ? 2 : 0) ? 1 : null;
      }, (x, y) => rampAt(MU, y < hy + 9 ? 0.75 : 0.45, x, y));
    } else if (!o.beard) pb.stroke([[hx - 1 + (side ? 7 : 0), hy + 9], [hx + 1 + (side ? 7 : 0), hy + 9]], hex('#7a3a3a'), 1);
  }
  // hat
  if (o.hat === 'cap' && HT) {
    pb.ellPart(hx, hy - 7, 13.5, 8.5, (x, y, i) => i.ny > 0.35 ? null : rampAt(HT, lam(i.nx, i.ny) + 0.1 - (x === hx && !side ? 0.2 : 0), x, y));
    if (!back) {
      if (side) pb.part(hx + 4, hy - 5, hx + 17, hy - 2, (x, y) => (x < hx + 16 - (y < hy - 4 ? 2 : 0)) ? 1 : null, (x, y) => rampAt(HT, y < hy - 2 ? 0.5 : 0.25, x, y));
      else pb.part(hx - 12, hy - 5, hx + 12, hy - 2, (x, y) => Math.abs(x + 0.5 - hx) < 12 - (y > hy - 3 ? 1 : 0) ? 1 : null, (x, y) => rampAt(HT, y < hy - 2 ? 0.55 : 0.3, x, y));
    }
  } else if (o.hat === 'bucket' && HT) {
    pb.ellPart(hx, hy - 8, 12, 8, (x, y, i) => i.ny > 0.4 ? null : rampAt(HT, lam(i.nx, i.ny) + 0.1, x, y));
    pb.part(hx - 16, hy - 6, hx + 16, hy - 2, (x, y) => Math.abs(x + 0.5 - hx) < 16 - Math.abs(y - (hy - 4)) * 1.5 ? 1 : null, (x, y) => rampAt(HT, y < hy - 3 ? 0.6 : 0.32, x, y));
    pb.rect(hx - 11, hy - 7, 22, 1, hex(o.band || '#8a3a3a'));
  }
  if (o.rod && dir !== 'up') {
    const rx = side ? 25 : hx + tw + 2;
    pb.stroke([[rx, 52], [rx + 10, 4]], INK, 3); pb.stroke([[rx, 52], [rx + 10, 4]], hex('#b08850'), 1);
    pb.stroke([[rx + 10, 4], [rx + 13, 30]], hex('#d8e0f0'), 1);
  }
  pb.seal();
  return pb.canvas();
}
function makeDogPX(col) {
  const out = [], B = shades(col), CR = shades('#f4e6cc'), EAR = shades('#9a5e34');
  for (let f = 0; f < 2; f++) {
    const pb = new Sheet(48, 38), bob = f;
    // far legs
    for (const [lx, ph] of [[16, 1 - f], [34, f]]) pb.part(lx - 2, 27, lx + 3, 36, (x, y) => (Math.abs(x - lx - (y - 27) * 0.2 * (ph ? 1 : -1)) < 2.3) ? 1 : null, (x, y) => rampAt(B, 0.28, x, y));
    // wagging tail
    const tw = f ? -3 : 1;
    pb.stroke([[39, 22 + bob], [43, 18 + tw], [45, 13 + tw]], INK, 4); pb.stroke([[39, 22 + bob], [43, 18 + tw], [45, 13 + tw]], B[3], 2);
    // long, low body with a cream belly
    pb.ellPart(27, 25 + bob, 14, 7.5, (x, y, i) => rampAt(i.ny > 0.4 ? CR : B, lam(i.nx, i.ny) + 0.12, x, y));
    // near legs
    for (const [lx, ph] of [[19, f], [37, 1 - f]]) pb.part(lx - 3, 29, lx + 3, 37, (x, y) => (Math.abs(x - lx - (y - 29) * 0.22 * (ph ? 1 : -1)) < 2.5) ? 1 : null, (x, y) => rampAt(y > 34 ? CR : B, 0.55, x, y));
    // head, muzzle, floppy ear, collar
    pb.ellPart(12, 15 + bob, 9, 8.5, (x, y, i) => rampAt(B, lam(i.nx, i.ny) + 0.15, x, y));
    pb.ellPart(5, 19 + bob, 5.5, 4, (x, y, i) => rampAt(CR, lam(i.nx, i.ny) + 0.1, x, y));
    pb.rect(1, 17 + bob, 2, 2, INK);
    pb.ellPart(17, 15 + bob, 3.5, 6.5, (x, y, i) => rampAt(EAR, lam(i.nx, i.ny) * 0.9, x, y), { rot: -0.35 });
    pb.rect(9, 12 + bob, 2, 3, hex('#24182e')); pb.set(9, 12 + bob, hex('#fffaf0'));
    if (f) pb.rect(4, 23 + bob, 2, 2, hex('#e06a7a'));
    pb.part(15, 21 + bob, 21, 23 + bob, () => 1, (x) => x === 18 ? hex('#ffd24a') : hex('#c8343a'));
    pb.seal();
    out.push(pb.canvas());
  }
  return out;
}
function makeCatPX(col) {
  const out = [], B = shades(col);
  for (let f = 0; f < 2; f++) {
    const pb = new Sheet(34, 40);
    // tail curling round
    const tw = f ? 2 : -1;
    pb.stroke([[24, 34], [30, 30], [31 + tw, 22], [28 + tw, 16]], INK, 4); pb.stroke([[24, 34], [30, 30], [31 + tw, 22], [28 + tw, 16]], B[2], 2);
    pb.ellPart(16, 29, 10, 9, (x, y, i) => rampAt(B, lam(i.nx, i.ny) + 0.1 - ((x + y * 2) % 6 === 0 && i.nx > -0.2 ? 0.15 : 0), x, y), { edge: (a, u, v) => v > 0.5 ? 1.15 : 1 });
    for (const sx of [-1, 1]) pb.ellPart(16 + sx * 4, 37, 3, 2, (x, y, i) => rampAt(B, 0.75, x, y));
    pb.ellPart(16, 15, 9, 8, (x, y, i) => rampAt(B, lam(i.nx, i.ny) + 0.15, x, y));
    for (const sx of [-1, 1]) pb.part(16 + sx * 7 - 3, 3, 16 + sx * 7 + 3, 10, (x, y) => (Math.abs(x + 0.5 - (16 + sx * 6)) < (y - 3) * 0.55) ? 1 : null, (x, y) => (Math.abs(x + 0.5 - (16 + sx * 6)) < (y - 5) * 0.3 ? hex('#d88a9a') : rampAt(B, 0.6, x, y)));
    const blink = f === 1;
    for (const ex of [11, 19]) {
      if (blink) pb.rect(ex, 15, 3, 1, INK);
      else { pb.rect(ex, 14, 3, 3, hex('#e8d24a')); pb.rect(ex + 1, 14, 1, 3, INK); }
    }
    pb.set(15, 18, hex('#e07a8a')); pb.set(16, 18, hex('#e07a8a'));
    pb.seal();
    out.push(pb.canvas());
  }
  return out;
}
function makeLyingGrandpaPX() {
  const pb = new Sheet(76, 36);
  const MAT = shades('#c25e52'), WH = shades('#e8e4ea');
  pb.part(1, 22, 74, 33, () => 1, (x, y) => (y === 22 || y === 32) ? MAT[1] : ((x + y) % 4 === 0 ? MAT[1] : ((x >> 2) % 2 ? MAT[2] : MAT[3])));
  // legs and shoes (feet up, to the right)
  pb.part(46, 15, 66, 25, () => 1, (x, y) => rampAt(shades('#5a4a6a'), y < 18 ? 0.7 : 0.45, x, y));
  pb.ellPart(68, 15, 3.5, 6, (x, y, i) => rampAt(shades('#5a3828'), lam(i.nx, i.ny) + 0.1, x, y));
  // body (green cardigan), hands folded on the tummy
  pb.ellPart(36, 18, 14, 8, (x, y, i) => rampAt(shades('#6a8a5a'), lam(i.nx, i.ny) + 0.15 - ((x * 2 + y) % 7 === 0 ? 0.12 : 0), x, y));
  pb.ellPart(36, 12, 4.5, 2.6, (x, y, i) => rampAt(SKIN, lam(i.nx, i.ny) + 0.2, x, y));
  // head in profile, face up: white fringe at the back, nose, closed eye, glasses, beard down the chest
  pb.ellPart(4, 17, 4, 5, (x, y, i) => rampAt(WH, lam(i.nx, i.ny) + 0.2, x, y));
  pb.ellPart(12, 17, 8.5, 8, (x, y, i) => rampAt(SKIN, lam(i.nx, i.ny) + 0.15, x, y));
  pb.ellPart(19, 17, 5, 4, (x, y, i) => rampAt(WH, lam(i.nx, i.ny) + 0.3 - ((x + y) % 3 === 0 ? 0.12 : 0), x, y), { rot: 0.2 });
  pb.set(12, 8, SKIN[2]); pb.set(12, 7, INK); pb.set(13, 8, INK); pb.set(11, 8, INK);                         // nose tip
  pb.stroke([[9, 12], [11, 12]], INK, 1);                                                                       // closed eye
  pb.stroke([[8, 10], [12, 10], [12, 13], [8, 13], [8, 10]], hex('#3a3040'), 1);                               // glasses
  pb.stroke([[8, 9], [11, 9]], WH[3], 1);                                                                       // brow
  pb.seal();
  return pb.canvas();
}


function makeLanternPX(seed) {
  // a small stolen street-lamp head / hand lantern (Gerald's hoard), glass still glowing
  const R = rng(seed), W = 22, H = 30, pb = new Sheet(W, H), eb = new PB(W, H);
  const BR = ramp('#2a1a14', '#5a3a1e', '#8a6030', '#c09048', '#e8c070');
  const GL = ramp('#c05a1a', '#f08a2a', '#ffb84a', '#ffe08a', '#fff6c8');
  const tilt = (R() - 0.5) * 0.3;
  pb.ellPart(11, 5, 4, 3, (x, y, i) => i.ny > 0.3 ? null : rampAt(BR, lam(i.nx, i.ny) + 0.2, x, y));     // handle ring
  pb.part(4, 7, 18, 10, () => 1, (x, y) => rampAt(BR, y < 9 ? 0.75 : 0.45, x, y));                       // cap
  pb.part(5, 10, 17, 25, (x, y) => Math.abs(x + 0.5 - 11 - (y - 17) * tilt) < 6 ? 1 : null, (x, y) => {
    const dx = x + 0.5 - 11 - (y - 17) * tilt;
    if (Math.abs(dx) > 4.6 || Math.abs(dx) < 0.6) return rampAt(BR, dx < 0 ? 0.7 : 0.4, x, y);           // frame bars
    const g = 1 - Math.abs(dx) / 5 - Math.abs(y - 18) / 12 + (hash2(x, y, seed) - 0.5) * 0.15;
    const c = rampAt(GL, 0.25 + g * 0.8, x, y);
    eb.set(x, y, c);
    return c;
  });
  pb.part(3, 25, 19, 28, () => 1, (x, y) => rampAt(BR, y < 26 ? 0.7 : 0.4, x, y));                      // base
  pb.seal();
  return { c: pb.canvas(), e: eb.canvas() };
}


/* ---------- Whisperwood trees, drawn natively at the props' 56 px/m ----------
   One texel grid for the whole set: every tree is generated at its in-world height x 56 px, so the
   canopies carry the same pixel size as the rocks, bushes and ground (no upscaled fat pixels).
   Night palette (moonlight from the upper left): deep blue-green needles / leaves, moon-silvered
   upper edges, 1-texel dark outline on the silhouette, 2x2-cell clump texture, no smooth gradients. */
const PINE = ramp('#0a1418', '#132630', '#1c3a40', '#285048', '#356654', '#4a7e60', '#66986c', '#8cb47c');
const PINE_RIM = ramp('#9cc8a4', '#c4e4c8', '#eaf8ec');
const BARKN = ramp('#0e0c12', '#221c22', '#382c2c', '#524036', '#6e5644', '#8c7056');
function makePinePX(seed, H) {
  const R = rng(seed);
  H = Math.round(H);
  const W = Math.round(H * (0.52 + R() * 0.08));
  const pb = new Sheet(W, H), cx = W / 2 + (R() - 0.5) * 2;
  const base = H - 2, S = H / 400;
  // trunk (shows in the gaps and under the lowest boughs)
  const tw = Math.max(3, Math.round(H * 0.024));
  pb.part(cx - tw * 3, H * 0.15, cx + tw * 3, base, (x, y) => {
    const flare = y > base - H * 0.05 ? (y - (base - H * 0.05)) * 0.7 : 0;
    return Math.abs(x - cx) < tw + flare ? { hw: tw + flare } : null;
  }, (x, y, i) => {
    const t = (x - cx) / i.hw;
    let s = 0.6 - t * 0.42;
    if (((x + (y >> 3)) % 3) === 0) s -= 0.14;
    return rampAt(BARKN, s, x, y, false);
  }, { ink: BARKN[0] });
  // boughs: tiers drawn from the bottom up (upper tiers overlap lower ones). Each tier is a pair of
  // drooping needle fans curving down from the trunk to the tips, with a sawtooth fringe of needle
  // points on the underside; inside, 1-texel needle dashes run along the bough. The outer part of
  // each tier shows its moonlit upper surface, the inner part the shadow under the tier above.
  const nT = 7 + Math.floor(R() * 3), top = 2, bot = H * (0.8 + R() * 0.05);
  const per = Math.max(4, Math.round(6 * S));
  const bough = (i, sg, hw, yA, th, droop, ph, shade) => {
    const dir = sg ? 1 : -1;
    for (let x = Math.floor(cx + (sg ? 0 : -hw - 2)); x <= Math.ceil(cx + (sg ? hw + 2 : 0)); x++) {
      if (x < 0 || x >= W) continue;
      const dx = x + 0.5 - cx;
      if (dx * dir < -1) continue;
      const u = Math.abs(dx) / hw;
      if (u > 1) continue;
      // upper edge: convex, drooping toward the tip; tufts of needles poke up here and there
      const yUp = yA + th * droop * 1.05 * Math.pow(u, 1.25) - (hash2(x >> 1, i * 2 + sg, seed + 3) > 0.82 ? 1 : 0);
      // a thick bough near the trunk, tapering to a pointed tip
      const thick = th * (0.45 + 0.5 * (1 - u)) * Math.min(1, (1 - u) * 5);
      // ragged needle fringe on the underside: teeth of varying length leaning outward
      const tooth = Math.floor((Math.abs(dx) + ph) / per), saw = ((Math.abs(dx) + ph) % per) / per;
      const tl = 0.12 + 0.24 * hash2(tooth, i * 2 + sg, seed + 17);
      const yLo = yUp + thick + th * tl * (1 - saw) * (0.5 + 0.6 * u);
      for (let y = Math.floor(yUp); y <= Math.ceil(yLo); y++) {
        if (y < 0 || y >= H) continue;
        const d = (y - yUp) / Math.max(1, yLo - yUp);          // 0 top surface .. 1 fringe
        let s = shade + 0.8 - d * 0.62 - (sg ? 0.14 : -0.05) * u - (1 - u) * 0.1;
        // needle dashes running along the bough
        const row = Math.floor((y - yUp) / 2), seg = Math.floor((Math.abs(dx) + row * 3) / (per - 1));
        const h = hash2(row, seg * 2 + sg, seed * 13 + i);
        if (h > 0.68) s += 0.12; else if (h < 0.2) s -= 0.12;
        if (d > 0.9) s = 0.04;                                   // dark fringe line
        pb.set(x, y, rampAt(PINE, s, x, y, false));
      }
    }
  };
  for (let i = nT - 1; i >= 0; i--) {
    const a = i / nT, b = (i + 1) / nT;
    const y0 = top + (bot - top) * Math.pow(a, 1.15) - (i ? 9 * S : 0), y1 = top + (bot - top) * Math.pow(b, 1.15);
    const th = y1 - y0;
    const hwBase = (W * 0.48) * (0.1 + 0.9 * Math.pow(b, 0.92));
    for (const sg of [0, 1]) {
      // two or three overlapping boughs per side: a long back one and shorter, lower front ones,
      // so every tier ends in a layered, uneven set of tips
      const n = i < 2 ? 1 : 2 + (R() < 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const hw = hwBase * (k === 0 ? 0.9 + R() * 0.16 : 0.5 + R() * 0.3);
        bough(i, sg, hw, y0 + th * (k ? 0.14 + R() * 0.16 : 0), th * (k ? 0.85 : 1), 0.8 + R() * 0.3, R() * 50, k ? 0.03 : -0.05);
      }
    }
  }
  // moon-silvered upper surfaces: the top texel of each clump on the lit side
  const src = new Uint8ClampedArray(pb.d);
  const lum = (x, y) => { const k = (y * W + x) * 4; return src[k + 3] ? src[k] + src[k + 1] + src[k + 2] : -1; };
  const ink = PINE[0][0] + PINE[0][1] + PINE[0][2];
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const l = lum(x, y); if (l < 0 || l <= ink + 2) continue;
    const up = lum(x, y - 1);
    if (up >= 0 && up > ink + 2) continue;            // not a top edge
    const lit = 0.6 - (x - cx) / (W * 0.5) + (hash2(x >> 1, y, seed + 9) - 0.5) * 0.4;
    if (lit > 0.95) { pb.set(x, y, PINE_RIM[lit > 1.3 ? 2 : 1]); if (lum(x, y + 1) > ink + 2) pb.set(x, y + 1, PINE_RIM[0]); }
    else if (lit > 0.55) pb.set(x, y, PINE[7]);
  }
  pb.outlineOuter();
  return pb.canvas();
}

const LEAFN = ramp('#08140f', '#0f2219', '#173422', '#22482c', '#305e36', '#427840', '#5a924a', '#7cac58', '#a8c870');
function makeBroadleafPX(seed, H) {
  const R = rng(seed);
  H = Math.round(H);
  const W = Math.round(H * (0.86 + R() * 0.1));
  const pb = new Sheet(W, H), cx = W / 2, base = H - 3;
  const S = H / 300;                                   // feature scale (300 px ~ a 5.4 m tree)
  // trunk with a root flare, splitting into limbs under the canopy
  const trunkTop = H * 0.45, tw = 12 * S;
  pb.part(cx - tw * 3, trunkTop, cx + tw * 3, base, (x, y) => {
    const t = (y - trunkTop) / (base - trunkTop);
    const hw = tw * (0.7 + 0.3 * t) + Math.pow(Math.max(0, t - 0.8) / 0.2, 2) * tw * 1.7;
    const wob = Math.sin(y * 0.04 + seed) * 3 * S;
    return Math.abs(x - cx - wob) < hw ? { t, hw, wob } : null;
  }, (x, y, i) => {
    const u = (x - cx - i.wob) / i.hw;
    let s = 0.56 - u * 0.42;
    if (((x + Math.round(Math.sin(y * 0.11) * 2)) % Math.max(3, Math.round(5 * S))) === 0) s -= 0.18;   // bark furrows
    if (hash2(x >> 1, y >> 1, seed) > 0.92) s += 0.12;
    return rampAt(BARKN, s, x, y, false);
  }, { ink: BARKN[0] });
  for (const side of [-1, 1]) {
    const pts = [[cx + side * 2 * S, trunkTop + 40 * S], [cx + side * 30 * S, trunkTop - 10 * S], [cx + side * 62 * S, trunkTop - 26 * S]];
    pb.stroke(pts, BARKN[0], Math.max(3, Math.round(11 * S)));
    pb.stroke(pts, BARKN[side < 0 ? 4 : 2], Math.max(1, Math.round(7 * S)));
  }
  // canopy: leaf clumps filling a dome; back / upper / outer clumps first, so the lower-front
  // clumps overlap them with dark contours (reads as a mass of foliage, not one blob)
  const clumps = [];
  const n = 22 + Math.floor(R() * 8);
  const ccy = H * 0.34, crx = W * 0.4, cry = H * 0.29;
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R());
    const x = cx + Math.cos(a) * crx * rr, y = ccy + Math.sin(a) * cry * rr * 0.9;
    const r = (30 + R() * 22) * S * (1.1 - rr * 0.3);
    clumps.push([x, y, r, R()]);
  }
  clumps.sort((p, q) => (p[1] - Math.abs(p[0] - cx) * 0.35) - (q[1] - Math.abs(q[0] - cx) * 0.35));
  for (const [x, y, r, sd] of clumps) {
    pb.ellPart(x, y, r, r * 0.8, (px, py, i) => {
      // each clump lit from the upper left, plus the dome as a whole (upper left of the crown brightest)
      let s = lam(i.nx * 0.85, i.ny * 0.9, 0.05) * 0.5 + 0.12 - ((px - cx) / crx) * 0.1 - ((py - ccy) / cry) * 0.12;
      const h = hash2(px >> 1, py >> 1, (sd * 997) | 0);
      if (h > 0.82 && s > 0.3) s += 0.12; else if (h < 0.16) s -= 0.12;
      if (hash2(px >> 1, py, 41 + seed) > 0.96 && i.ny < -0.2) s += 0.22;     // leaf glints
      return rampAt(LEAFN, s, px, py, false);
    }, { ink: LEAFN[0], edge: (a) => 1 - 0.1 * Math.abs(Math.sin(a * 6 + sd * 9)) - 0.06 * Math.abs(Math.sin(a * 13 + sd * 3)) });
  }
  // ragged leafy rim: knock out texels on the silhouette, then re-ink
  const src = new Uint8ClampedArray(pb.d);
  const a = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < base - H * 0.42; y++) for (let x = 0; x < W; x++) {
    if (!a(x, y)) continue;
    const edge = !a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1);
    if (edge && hash2(x >> 1, y >> 1, seed + 5) > 0.55) pb.clear(x, y);
  }
  pb.outlineOuter();
  // re-colour the new ink ring with the darkest leaf so the canopy edge is not inked like a character
  for (let i = 0; i < W * H; i++) if (pb.d[i * 4 + 3] && pb.d[i * 4] === INK[0] && pb.d[i * 4 + 1] === INK[1] && pb.d[i * 4 + 2] === INK[2]) { pb.d[i * 4] = 3; pb.d[i * 4 + 1] = 8; pb.d[i * 4 + 2] = 10; }
  return pb.canvas();
}

// a bare, gnarled dead tree (the clearing's edge): limbs as tapering strokes
function makeDeadTreePX(seed, H) {
  const R = rng(seed);
  H = Math.round(H);
  const W = Math.round(H * 0.8), pb = new Sheet(W, H), S = H / 300;
  const segs = [];
  const grow = (x, y, ang, len, w, d) => {
    const pts = [[x, y]];
    let px = x, py = y, a = ang;
    const n = 6;
    for (let k = 0; k < n; k++) { a += (R() - 0.5) * 0.35; px += Math.sin(a) * len / n; py -= Math.cos(a) * len / n; pts.push([px, py]); }
    segs.push([pts, w]);
    if (d > 0 && w > 1.5) {
      const nb = d > 2 ? 2 : 2 + Math.floor(R() * 2);
      for (let b = 0; b < nb; b++) grow(px, py, a + (b - (nb - 1) / 2) * (0.6 + R() * 0.4), len * (0.55 + R() * 0.2), w * 0.62, d - 1);
    }
  };
  grow(W / 2, H - 3, (R() - 0.5) * 0.15, H * 0.38, 16 * S, 4);
  for (const [pts, w] of segs) pb.stroke(pts, BARKN[0], Math.max(2, Math.round(w + 2)));
  for (const [pts, w] of segs) pb.stroke(pts, (x, y) => rampAt(BARKN, 0.75 - ((x - W / 2) / W) * 0.6 + (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.2, x, y, false), Math.max(1, Math.round(w)));
  // moonlit tops of the limbs
  const src = new Uint8ClampedArray(pb.d);
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) if (src[(y * W + x) * 4 + 3] && !src[((y - 1) * W + x) * 4 + 3] && x < W * 0.62 && hash2(x, y, 3) > 0.3) pb.set(x, y, hex('#8aa0a8'));
  // root flare
  pb.ellPart(W / 2, H - 4, 22 * S, 5 * S, (x, y, i) => i.ny < -0.2 ? null : rampAt(BARKN, 0.5 - i.nx * 0.3, x, y, false), { ink: BARKN[0] });
  return pb.canvas();
}

export { TAU, clamp, lerp, smooth, easeOut, easeOutBack, rand, irand, pick, dist, rng, hash2, hex, mixc, mulc, css, dk, lt, mk, PB, vol, C, makeChar, drawChar, makePortrait, makeDog, makeCat, makeLyingGrandpa, makeRock, makeMushrooms, makeStump, makeBush, makeGate, makeOldLamp, makeFlowerPatch, makeShrub, makeMoth, ICONS, makeIcons, makeFieldShrub, makeFieldMoth, makeMothPX, makeShrubPX, makeBoulderPX, makeStumpPX, makeMushPX, makeOldLampPX, Sheet, ramp, rampAt, lam, INK, makeChibiPX, makeDogPX, makeCatPX, makeLyingGrandpaPX, makeLanternPX, makePinePX, makeBroadleafPX, makeDeadTreePX };
