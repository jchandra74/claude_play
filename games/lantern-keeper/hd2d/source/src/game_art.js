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
export { TAU, clamp, lerp, smooth, easeOut, easeOutBack, rand, irand, pick, dist, rng, hash2, hex, mixc, mulc, css, dk, lt, mk, PB, vol, C, makeChar, drawChar, makePortrait, makeDog, makeCat, makeLyingGrandpa, makeRock, makeMushrooms, makeStump, makeBush, makeGate, makeOldLamp, makeFlowerPatch, makeShrub, makeMoth, ICONS, makeIcons, makeFieldShrub, makeFieldMoth };
