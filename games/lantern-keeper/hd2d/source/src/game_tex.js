// Texture registry for the playable demo: native HD sprites (assets/native) and procedural sprites
// generated from the original game's pixel generators (game_art.js). Procedural art is either drawn
// natively at a higher scale (Gerald, mothlings, shrubs: re-parameterised generators below) or
// upscaled 2x with EPX/Scale2x so it lands near the 56 px/m grid without fat pixels.
import * as THREE from 'three';
import { image, spriteTex } from './assets.js';
import {
  PB, hex, mixc, dk, lt, vol, hash2, C, mk,
  makeChar, makeDog, makeCat, makeLyingGrandpa, makeRock, makeMushrooms, makeStump, makeOldLamp, makeIcons,
} from './game_art.js';

const FRAMES = new Map();     // key -> { tex, w, h, canvas, emis }

export function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

// Scale2x / EPX: doubles a pixel-art canvas, rounding staircase corners without inventing colours.
export function epx(src) {
  const w = src.width, h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, x] = mk(w * 2, h * 2);
  const out = x.createImageData(w * 2, h * 2), od = out.data;
  const px = (i, j) => (i < 0 || j < 0 || i >= w || j >= h) ? -1 : (j * w + i);
  const eq = (a, b) => {
    if (a < 0 || b < 0) return a === b || (a < 0 && sd[b * 4 + 3] === 0) || (b < 0 && sd[a * 4 + 3] === 0);
    const p = a * 4, q = b * 4;
    if (sd[p + 3] === 0 && sd[q + 3] === 0) return true;
    return sd[p] === sd[q] && sd[p + 1] === sd[q + 1] && sd[p + 2] === sd[q + 2] && sd[p + 3] === sd[q + 3];
  };
  const put = (ox, oy, s) => {
    const o = (oy * w * 2 + ox) * 4;
    if (s < 0) { od[o + 3] = 0; return; }
    od[o] = sd[s * 4]; od[o + 1] = sd[s * 4 + 1]; od[o + 2] = sd[s * 4 + 2]; od[o + 3] = sd[s * 4 + 3];
  };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const P = px(i, j), A = px(i, j - 1), B = px(i + 1, j), Cc = px(i - 1, j), D = px(i, j + 1);
    let e0 = P, e1 = P, e2 = P, e3 = P;
    if (eq(Cc, A) && !eq(Cc, D) && !eq(A, B)) e0 = A;
    if (eq(A, B) && !eq(A, Cc) && !eq(B, D)) e1 = B;
    if (eq(D, Cc) && !eq(D, B) && !eq(Cc, A)) e2 = Cc;
    if (eq(B, D) && !eq(B, A) && !eq(D, Cc)) e3 = D;
    put(i * 2, j * 2, e0); put(i * 2 + 1, j * 2, e1); put(i * 2, j * 2 + 1, e2); put(i * 2 + 1, j * 2 + 1, e3);
  }
  x.putImageData(out, 0, 0);
  return c;
}

export function registerCanvas(key, canvas, emisCanvas = null) {
  const f = { tex: canvasTex(canvas), w: canvas.width, h: canvas.height, canvas, emis: emisCanvas ? canvasTex(emisCanvas) : null };
  FRAMES.set(key, f);
  return f;
}

// frame by key: registered procedural frame, or a native asset (by asset name)
export function frame(key) {
  let f = FRAMES.get(key);
  if (f) return f;
  const im = image(key);
  f = { tex: spriteTex(key), w: im.width, h: im.height, canvas: null, img: im, emis: null };
  FRAMES.set(key, f);
  return f;
}
export function frameCanvas(key) {
  const f = frame(key);
  if (f.canvas) return f.canvas;
  const [c, x] = mk(f.w, f.h);
  x.drawImage(f.img, 0, 0);
  f.canvas = c;
  return c;
}

// ---------- high-resolution re-draws of the original's monsters ----------
// Same shapes as the original makeMoth / makeShrub, every dimension scaled by `sc`, so the fur,
// wing eyespots and outlines are drawn at the 3D scene's texel density instead of being upscaled.
export function makeMothHD(big, sc) {
  const frames = [], efr = [];
  const W2 = Math.round((big ? 48 : 44) * sc), H2 = Math.round((big ? 42 : 40) * sc);
  const s = sc;
  for (let f = 0; f < 3; f++) {
    const pb = new PB(W2, H2), eb = new PB(W2, H2);
    const cx = W2 / 2, cy = H2 * 0.5;
    const wingC = big ? hex('#b89a7a') : hex('#c8b08a'), wingD = big ? hex('#8a6a5a') : hex('#9a8060');
    const flap = [0, 0.18, -0.12][f];
    for (const side of [-1, 1]) {
      const lobes = [[13, -4, 13, 10], [10, 8, 9, 8]];
      for (const [ox, oy, rx, ry] of lobes) {
        const wx = cx + side * ox * s, wy = cy + (oy - flap * 14 * (oy < 0 ? 1 : 0.4)) * s;
        pb.ell(wx, wy, rx * s * (1 - Math.abs(flap) * 0.5), ry * s, (nx, ny, x, y) => {
          const d = Math.hypot(nx, ny);
          let c = mixc(wingC, wingD, d * 0.7);
          // soft banding along the wing like moth scales
          if (Math.abs(d - 0.55) < 0.06) c = lt(wingC, 0.3);
          else if (Math.abs(d - 0.7) < 0.03) c = dk(wingC, 0.88);
          if (d > 0.84) c = dk(wingD, 0.78);
          if (nx * side > 0.1 && oy < 0) {
            const e = Math.hypot(nx * side - 0.25, ny + 0.1);
            if (e < 0.26) c = e < 0.1 ? hex('#2a1a3a') : e < 0.16 ? hex('#f0a040') : e < 0.2 ? hex('#ffd890') : dk(wingC, 0.75);
          }
          // veins
          const ang = Math.atan2(ny, nx * side);
          if (Math.abs(Math.sin(ang * 5)) < 0.06 && d > 0.25 && d < 0.84) c = dk(c, 0.86);
          if (hash2(x, y, 5) > 0.94) c = dk(c, 0.88);
          if (hash2(x, y, 9) > 0.97) c = lt(c, 0.2);
          return c;
        });
      }
    }
    pb.ell(cx, cy + 4 * s, 5 * s, 11 * s, (nx, ny, x, y) => {
      let c = vol(hex('#e8dcc8'), nx, ny);
      if (Math.floor(y / (2 * s)) % 3 === 0 && ny > 0) c = dk(c, 0.85);
      if (hash2(x, y, 4) > 0.9) c = lt(c, 0.25);
      return c;
    });
    pb.ell(cx, cy - 4 * s, 8 * s, 5 * s, (nx, ny, x, y) => (hash2(x, y, 2) > 0.75 && Math.hypot(nx, ny) > 0.82) ? null : vol(hash2(x >> 1, y >> 1, 7) > 0.7 ? hex('#fffaf0') : hex('#f4ecdc'), nx, ny));
    pb.ell(cx, cy - 9 * s, 6 * s, 5 * s, (nx, ny) => vol(hex('#efe4d2'), nx, ny));
    for (const side of [-1, 1]) {
      pb.ell(cx + side * 3.4 * s, cy - 9.5 * s, 2.6 * s, 3 * s, (nx, ny) => (nx < -0.15 && ny < -0.15 && nx > -0.75) ? C.white : (ny > 0.5 ? hex('#3a2a50') : hex('#1e1630')));
      for (let i = 0; i < 9 * s; i++) {
        const ax = cx + side * (2 * s + i * 0.7), ay = cy - 14 * s - i * 0.9;
        pb.set(ax, ay, hex('#8a6a4a')); pb.set(ax, ay + 1, hex('#6a4a3a'));
        if (i % 2 === 0) { pb.set(ax + side, ay - 1, hex('#a88a6a')); pb.set(ax - side, ay - 1, hex('#a88a6a')); pb.set(ax + side * 2, ay - 2, hex('#b89a7a')); }
      }
    }
    if (big) {
      // tiny bowtie and a glowing tummy full of stolen flame
      const by = cy - 1 * s;
      pb.ell(cx - 3 * s, by + 1.5 * s, 2.4 * s, 2 * s, (nx, ny) => vol(hex('#d03a5a'), nx, ny));
      pb.ell(cx + 3 * s, by + 1.5 * s, 2.4 * s, 2 * s, (nx, ny) => vol(hex('#d03a5a'), nx, ny));
      pb.ell(cx, by + 1.5 * s, 1.1 * s, 1.1 * s, hex('#ff6a8a'));
      pb.ell(cx, cy + 10 * s, 6 * s, 7 * s, (nx, ny) => mixc(hex('#ffe08a'), hex('#ff8a3a'), Math.hypot(nx, ny)));
      eb.ell(cx, cy + 10 * s, 6 * s, 7 * s, (nx, ny) => mixc(hex('#fff0b0'), hex('#ff8a3a'), Math.hypot(nx, ny)));
    }
    pb.outline(0.35);
    frames.push(pb.canvas());
    efr.push(big ? eb.canvas() : null);
  }
  return { frames, emis: efr, w: W2, h: H2 };
}

export function makeShrubHD(sc) {
  const frames = [];
  const W = Math.round(40 * sc), H = Math.round(36 * sc);
  for (let f = 0; f < 2; f++) {
    const pb = new PB(W, H);
    const leaf = hex('#4f9a42'), b = (34 - f) * sc;
    const blobs = [[20, -13, 13], [11, -9, 8], [29, -9, 8], [17, -22, 8], [25, -20, 7]].map(([x, y, r]) => [x * sc, b + y * sc, r * sc]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let bn = null, best = -1;
      for (const [bx, by, br] of blobs) { const dx = (x + 0.5 - bx) / br, dy = (y + 0.5 - by) / br, d = dx * dx + dy * dy; if (d < 1 && 1 - d > best) { best = 1 - d; bn = [dx, dy]; } }
      if (!bn) continue;
      if (best < 0.08 && hash2(x, y, 8) > 0.45) continue;
      // leaf clusters: shading quantised per 2x2 cell, with leaf-shaped highlights
      const s = bn[0] * 0.5 + bn[1] * 0.8 + (hash2(x >> 1, y >> 1, 3) - 0.5) * 0.45;
      let c = s > 0.55 ? dk(leaf, 0.55) : s > 0.15 ? dk(leaf, 0.8) : s < -0.5 ? lt(leaf, 0.32) : leaf;
      if (hash2(x >> 1, y, 11) > 0.9 && s < 0.3) c = lt(c, 0.18);
      pb.set(x, y, c);
    }
    const fy = b - 16 * sc;
    const R = (x, y, w, h, c) => pb.rect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), c);
    for (const ex of [14, 24]) {
      const X = ex * sc;
      R(X, fy, 5 * sc, 4 * sc, C.white); R(X + 2 * sc, fy + 2 * sc, 2 * sc, 2 * sc, C.eye);
      R(X + 2.4 * sc, fy + 2.2 * sc, 0.8 * sc, 0.8 * sc, C.white);
      R(X, fy, 5 * sc, 2 * sc, dk(leaf, 0.7));
    }
    const L = (x0, y0, x1, y1, c) => { for (let k = 0; k < Math.max(1, sc); k++) pb.line(Math.round(x0 * sc), Math.round(y0 + k), Math.round(x1 * sc), Math.round(y1 + k), c); };
    L(13, fy - 3 * sc, 19, fy - 2 * sc, hex('#2a3a1a'));
    L(23, fy - 5 * sc, 29, fy - 3 * sc, hex('#2a3a1a'));
    L(17, fy + 7 * sc, 24, fy + 7 * sc, hex('#2a1a1a')); L(24, fy + 7 * sc, 26, fy + 5 * sc, hex('#2a1a1a'));
    R(16 * sc, b - 1 * sc, 8 * sc, 2 * sc, hex('#6a4a30'));
    pb.outline(0.35);
    frames.push(pb.canvas());
  }
  return { frames, w: W, h: H };
}

// ---------- build every procedural frame the demo uses ----------
export const CHAR_LO = {};
export const PORTRAIT = {};
export function buildGameTextures() {
  makeIcons();
  // Gerald (boss) and the forest monsters, drawn at scene density
  const ger = makeMothHD(true, 4);
  ger.frames.forEach((c, i) => registerCanvas('gerald_' + i, c, ger.emis[i]));
  const mo = makeMothHD(false, 1.3);
  mo.frames.forEach((c, i) => registerCanvas('mothling_' + i, c));
  const sh = makeShrubHD(1.7);
  sh.frames.forEach((c, i) => registerCanvas('shrub_' + i, c));
  // side characters that have no HD art: the original generators, EPX-doubled
  CHAR_LO.odo = makeChar({ hairStyle: 'bald', hair: hex('#e8e4ea'), beard: hex('#eeeaf2'), shirt: hex('#6a8a5a'), pants: hex('#5a4a6a'), glasses: hex('#3a3040') });
  CHAR_LO.fenwick = makeChar({ hair: hex('#4a4a4a'), hat: 'cap', hatColor: hex('#4a6a9a'), shirt: hex('#a88a5a'), pants: hex('#5a5a6a'), mustache: hex('#4a4a4a') });
  CHAR_LO.glen = makeChar({ hair: hex('#7a5a3a'), hat: 'cap', hatColor: hex('#4a8a6a'), shirt: hex('#d0b070'), pants: hex('#4a5a7a'), beard: hex('#7a5a3a') });
  for (const id of ['fenwick', 'glen']) {
    for (const d of ['down', 'left', 'right', 'up']) registerCanvas(`${id}_${d}`, epx(CHAR_LO[id].frames[d][0]));
  }
  registerCanvas('odo_lying', epx(makeLyingGrandpa()));
  const dog = makeDog(hex('#d8a060'));
  dog.forEach((c, i) => registerCanvas('dog_' + i, epx(c)));
  const cat = makeCat(hex('#5a5468'));
  cat.forEach((c, i) => registerCanvas('cat_' + i, epx(c)));
  // forest dressing
  for (let i = 0; i < 6; i++) { const m = makeMushrooms(200 + i * 7); registerCanvas('mush_' + i, epx(m.c), epx(m.e)).col = m.col; }
  for (let i = 0; i < 4; i++) registerCanvas('rock_' + i, epx(makeRock(300 + i * 11, 1.2 + (i % 2) * 0.5).c));
  registerCanvas('stump', epx(makeStump(3).c));
  registerCanvas('oldlamp', epx(makeOldLamp().c));
  // dialogue portraits (head and shoulders)
  PORTRAIT.odo = epx(CHAR_LO.odo.portrait); PORTRAIT.fenwick = epx(CHAR_LO.fenwick.portrait); PORTRAIT.glen = epx(CHAR_LO.glen.portrait);
  const crop = (name, y0, y1) => {
    const im = image(name), h = Math.round(im.height * (y1 - y0)), w = Math.min(im.width, Math.round(h * 1.1));
    const [c, x] = mk(w, h);
    x.drawImage(im, Math.round((im.width - w) / 2), -Math.round(im.height * y0));
    return c;
  };
  PORTRAIT.pip = crop('pip_down_0', 0.0, 0.62); PORTRAIT.moss = crop('moss_down_0', 0.0, 0.62);
  PORTRAIT.mayor = crop('mayor', 0.02, 0.5); PORTRAIT.baker = crop('baker', 0.0, 0.5); PORTRAIT.barnaby = crop('guard', 0.03, 0.5);
  PORTRAIT.tobin = crop('kid', 0.0, 0.55); PORTRAIT.zuzu = crop('zuzu', 0.08, 0.55); PORTRAIT.wendell = crop('guard', 0.03, 0.5);
  {
    const g = ger.frames[0], [c, x] = mk(Math.round(g.width * 0.5), Math.round(g.height * 0.5));
    x.drawImage(g, -Math.round(g.width * 0.25), -Math.round(g.height * 0.04));
    PORTRAIT.gerald = c;
  }
}
