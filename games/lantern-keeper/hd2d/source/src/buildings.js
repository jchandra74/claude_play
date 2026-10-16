// Houses: stone plinth, per-face painted facades (half-timber / stone / boards) laid out around the
// actual door & window openings with baked eave + base AO and drop shadows, jettied upper floors,
// steep shingled gable roofs with per-tile weathering, chimneys, lean-to sheds, and pixel-art
// doors / windows / signs as shadow-casting wall decals.
import * as THREE from 'three';
import { HOUSES, TIER, rng } from './layout.js';
import { tileTex, makeDecal, radialTex, image, size } from './assets.js';
import { worldUV, triGeometry, heightAO, mergeGeos } from './geom.js';
import { pxName } from './props.js';
import { makeSprite } from './assets.js';

const F1 = 2.15, F2 = 1.95, PLINTH = 0.3;
const PX = 64; // facade texels per metre (matches the 128px / 2m pixel-art tiles)

// ---------------- shared weathering shader patch ----------------
// Breaks texture repetition: per-tile brightness jitter + low-frequency world-space blotches.
function weather(mat, cells = 8, amt = 0.22, blot = 0.25) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCells = { value: cells }; sh.uniforms.uAmt = { value: amt }; sh.uniforms.uBlot = { value: blot };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPosW; uniform float uCells, uAmt, uBlot;
float wh21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float wvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wh21(i), wh21(i+vec2(1,0)), f.x), mix(wh21(i+vec2(0,1)), wh21(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  { vec2 cell = floor(vMapUv * uCells);
    float j = wh21(cell + floor(vWPosW.xz * 0.37));
    float b = wvn(vWPosW.xz * 0.45 + vWPosW.y * 0.6);
    diffuseColor.rgb *= (1.0 - uAmt * 0.5 + uAmt * j) * (1.0 - uBlot * 0.6 + uBlot * b);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.95, 0.62), smoothstep(0.72, 0.95, b) * 0.5); }
#endif`);
  };
  mat.customProgramCacheKey = () => 'weather' + cells + amt + blot;
  return mat;
}

let mats = null;
function materials() {
  if (mats) return mats;
  const stone = tileTex('tex_stonebrick'), planks = tileTex('tex_planks');
  mats = {
    stone: weather(new THREE.MeshStandardMaterial({ map: stone, roughness: 0.92, color: 0xa49a90, vertexColors: true }), 6, 0.2, 0.3),
    beam: weather(new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9, color: 0x6e4a32 }), 4, 0.2, 0.2),
    darkBeam: new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9, color: 0x4a3222 }),
    planks: weather(new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9, color: 0x9a7456, vertexColors: true }), 4, 0.25, 0.3),
    chimneyTop: new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 1 }),
    roofs: new Map(),
  };
  return mats;
}
function roofMat(tint) {
  const m = materials();
  if (!m.roofs.has(tint)) {
    m.roofs.set(tint, weather(new THREE.MeshStandardMaterial({ map: tileTex('tex_shingles'), roughness: 0.85, color: tint }), 9, 0.34, 0.35));
  }
  return m.roofs.get(tint);
}

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}

function box(w, h, d, x, y, z, mat, tile = 2.0, tileV = tile, uvOffset, ao) {
  const g = new THREE.BoxGeometry(w, h, d, 1, ao ? 2 : 1, 1);
  g.translate(x, y, z);
  worldUV(g, tile, tileV, uvOffset || [0, 0, 0]);
  if (mat.vertexColors) heightAO(g, y - h / 2, y + h / 2, ao ? ao : 1);
  return mesh(g, mat);
}

// ---------------- procedural facade painter ----------------
const C = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function vnoise(R) {
  const T = new Float32Array(64 * 64); for (let i = 0; i < T.length; i++) T[i] = R();
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = T[(iy & 63) * 64 + (ix & 63)], b = T[(iy & 63) * 64 + ((ix + 1) & 63)];
    const c = T[((iy + 1) & 63) * 64 + (ix & 63)], d = T[((iy + 1) & 63) * 64 + ((ix + 1) & 63)];
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  };
}

function paintPlaster(g, w, h, R, tone) {
  const [r0, g0, b0] = tone;
  // pixel-art plaster: two noise octaves quantised to 4 tones with ordered dithering,
  // damp grime rising from the base and a faint green-grey bloom in the lower corners
  const N = vnoise(R);
  const img = g.createImageData(w, h), D = img.data;
  const steps = [-34, -17, -3, 10];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = N(x / 26, y / 16) * 0.55 + N(x / 7 + 17, y / 5 + 9) * 0.3 + N(x / 2.5 + 3, y / 2.5) * 0.15;
    const base = Math.max(0, (y - h * 0.62) / (h * 0.38));
    v -= base * base * 0.45;
    const t = Math.max(0, Math.min(3.999, v * 4 - 0.4 + BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5));
    const d = steps[Math.floor(t)];
    const gr = base * base * 10;
    const o = (y * w + x) * 4;
    D[o] = r0 + d - gr * 1.2; D[o + 1] = g0 + d - gr * 0.6; D[o + 2] = b0 + d * 0.85 - gr * 1.1; D[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // sparse single-pixel speckle
  for (let k = 0; k < (w * h) / 70; k++) {
    const d = R() < 0.5 ? -18 : 10;
    g.fillStyle = C(r0 + d, g0 + d, b0 + d); g.fillRect((R() * w) | 0, (R() * h) | 0, 1, 1);
  }
  // exposed brick where the plaster has fallen away (jagged rim: dark top-left lip, lit bottom-right)
  const patches = Math.round(R() * 1.6 + (w * h) / 40000);
  for (let k = 0; k < patches; k++) {
    const cx = 16 + R() * (w - 32), cy = h * (0.25 + R() * 0.6), rx = 7 + R() * 9, ry = 4 + R() * 5;
    const inside = (x, y) => { const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; return q < 1 - 0.25 * Math.sin(x * 1.7 + y * 2.3); };
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      if (!inside(x, y)) continue;
      const row = Math.floor(y / 3), mortar = (y % 3 === 0) || ((x + (row & 1) * 3) % 6 === 0);
      const bv = ((x * 7 + row * 13) % 5) * 5;
      g.fillStyle = mortar ? C(150, 136, 118) : C(150 + bv, 78 + bv * 0.5, 58 + bv * 0.3);
      g.fillRect(x, y, 1, 1);
      if (!inside(x, y - 1) || !inside(x - 1, y)) { g.fillStyle = C(r0 - 70, g0 - 72, b0 - 70); g.fillRect(x, y, 1, 1); }
      else if (!inside(x, y + 1)) { g.fillStyle = C(r0 + 14, g0 + 14, b0 + 10); g.fillRect(x, y + 1, 1, 1); }
    }
  }
  // hairline cracks
  for (let k = 0; k < Math.round(w / 70); k++) {
    let x = R() * w, y = R() * h * 0.7 + 6;
    const len = 6 + R() * 16, dir = R() < 0.5 ? -1 : 1;
    for (let i = 0; i < len; i++) {
      g.fillStyle = C(r0 - 60, g0 - 62, b0 - 62); g.fillRect(x | 0, y | 0, 1, 1);
      g.fillStyle = C(r0 + 10, g0 + 10, b0 + 8); g.fillRect((x | 0) + 1, (y | 0) + 1, 1, 1);
      y += 1; x += (R() < 0.45 ? dir : 0) + (R() < 0.12 ? -dir : 0);
    }
  }
  // vertical weather streaks under the top plate (darker, warmer)
  for (let k = 0; k < w / 16; k++) {
    const x = (R() * w) | 0, len = 6 + R() * h * 0.4;
    for (let y = 0; y < len; y++) if (((x + y) & 1) === 0 || y < len * 0.4) { g.fillStyle = C(r0 - 20, g0 - 22, b0 - 22); g.fillRect(x, 12 + y, 1, 1); }
  }
}

function beamRect(g, x, y, w, h, R, col) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const [r, gg, b] = col;
  g.fillStyle = C(r, gg, b); g.fillRect(x, y, w, h);
  // grain
  const horiz = w > h;
  for (let k = 0; k < (w * h) / 14; k++) {
    g.fillStyle = C(r - 14, gg - 10, b - 8);
    if (horiz) g.fillRect(x + ((R() * w) | 0), y + 1 + ((R() * (h - 2)) | 0), 2 + ((R() * 5) | 0), 1);
    else g.fillRect(x + 1 + ((R() * (w - 2)) | 0), y + ((R() * h) | 0), 1, 2 + ((R() * 5) | 0));
  }
  g.fillStyle = C(r + 26, gg + 18, b + 12);
  if (horiz) g.fillRect(x, y, w, 1); else g.fillRect(x, y, 1, h);
  g.fillStyle = C(r * 0.55, gg * 0.55, b * 0.55);
  if (horiz) g.fillRect(x, y + h - 1, w, 1); else g.fillRect(x + w - 1, y, 1, h);
  // soft cast shadow on the plaster below / right
  g.fillStyle = 'rgba(40,24,12,0.25)';
  if (horiz) g.fillRect(x, y + h, w, 2); else g.fillRect(x + w, y, 2, h);
}

function brace(g, x0, y0, x1, y1, t, R, col) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    const s = i / n, x = x0 + (x1 - x0) * s, y = y0 + (y1 - y0) * s;
    g.fillStyle = C(col[0] - (i % 7 === 0 ? 12 : 0), col[1] - (i % 7 === 0 ? 9 : 0), col[2]);
    g.fillRect(Math.round(x - t / 2), Math.round(y), t, 1);
    g.fillStyle = C(col[0] * 0.55, col[1] * 0.55, col[2] * 0.55);
    g.fillRect(Math.round(x + t / 2), Math.round(y), 1, 1);
  }
}

function paintPlanks(g, w, h, R) {
  let x = 0;
  while (x < w) {
    const bw = 11 + ((R() * 5) | 0);
    const v = R() * 22 - 11;
    const col = [128 + v, 92 + v * 0.8, 62 + v * 0.6];
    g.fillStyle = C(...col); g.fillRect(x, 0, bw, h);
    for (let k = 0; k < bw * h / 10; k++) { g.fillStyle = C(col[0] - 14, col[1] - 11, col[2] - 8); g.fillRect(x + 1 + ((R() * (bw - 2)) | 0), (R() * h) | 0, 1, 3 + ((R() * 6) | 0)); }
    g.fillStyle = C(col[0] + 18, col[1] + 12, col[2] + 8); g.fillRect(x + 1, 0, 1, h);
    g.fillStyle = C(30, 20, 14); g.fillRect(x + bw - 1, 0, 1, h);
    // nails
    g.fillStyle = C(40, 34, 30);
    for (const yy of [6, h * 0.5, h - 8]) g.fillRect(x + (bw >> 1), yy | 0, 1, 1);
    x += bw;
  }
  // horizontal battens
  for (const yy of [h * 0.08, h * 0.88]) beamRect(g, 0, yy, w, 7, R, [92, 62, 40]);
}

// openings: [{u0,u1,v0,v1}] metres from the face's bottom-left, as seen from outside.
function facadeTexture(Wm, Hm, style, openings, seed, opts = {}) {
  const w = Math.max(8, Math.round(Wm * PX)), h = Math.max(8, Math.round(Hm * PX));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const R = rng(seed);
  const tone = opts.tone || [214, 196, 160];
  const beamCol = opts.beam || [86, 56, 36];
  const T = 11; // beam thickness px (~0.17 m)
  const yy = (v) => h - v * PX; // metres-from-bottom -> canvas y
  const ops = openings.map(o => ({ x0: o.u0 * PX, x1: o.u1 * PX, y0: yy(o.v1), y1: yy(o.v0) }));
  if (style === 'stone') {
    const pat = g.createPattern(image('tex_stonebrick'), 'repeat');
    g.save(); g.translate((seed * 37) % 128, h % 128); g.fillStyle = pat; g.fillRect(-256, -256, w + 512, h + 512); g.restore();
    // per-stone tone variation, mossy damp base
    for (let y = 0; y < h; y += 9) for (let x = -((y / 9) % 2) * 10; x < w; x += 20) {
      const v = R();
      if (v < 0.3) { g.fillStyle = 'rgba(30,24,18,0.16)'; g.fillRect(x, y, 20, 9); }
      else if (v > 0.8) { g.fillStyle = 'rgba(255,236,200,0.1)'; g.fillRect(x, y, 20, 9); }
      else if (v > 0.74 && y > h * 0.55) { g.fillStyle = 'rgba(70,110,40,0.22)'; g.fillRect(x, y, 20, 9); }
    }
    // dressed quoins at corners
    for (let y = h; y > 0; y -= 18) {
      const big = ((h - y) / 18) & 1;
      for (const [x, ww] of [[0, big ? 22 : 14], [w - (big ? 22 : 14), big ? 22 : 14]]) {
        g.fillStyle = C(176, 166, 150); g.fillRect(x, y - 17, ww, 16);
        g.fillStyle = C(204, 196, 182); g.fillRect(x, y - 17, ww, 1);
        g.fillStyle = C(90, 84, 78); g.fillRect(x, y - 1, ww, 1);
      }
    }
    // lintels over openings
    for (const o of ops) {
      g.fillStyle = C(170, 158, 140); g.fillRect(o.x0 - 6, o.y0 - 12, o.x1 - o.x0 + 12, 11);
      g.fillStyle = C(110, 100, 92); g.fillRect(o.x0 - 6, o.y0 - 2, o.x1 - o.x0 + 12, 1);
    }
  } else if (style === 'planks') {
    paintPlanks(g, w, h, R);
    for (const o of ops) beamRect(g, o.x0 - 6, o.y0 - 9, o.x1 - o.x0 + 12, 8, R, [70, 46, 30]);
  } else {
    paintPlaster(g, w, h, R, tone);
    // timber frame laid out around the openings
    const posts = new Set([0, w - T]);
    for (const o of ops) { posts.add(Math.max(0, Math.round(o.x0 - T - 2))); posts.add(Math.min(w - T, Math.round(o.x1 + 2))); }
    // fill wide bays with extra studs
    let sorted = [...posts].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap > PX * 1.5) { const n = Math.round(gap / (PX * 1.05)); for (let k = 1; k < n; k++) posts.add(Math.round(sorted[i] + gap * k / n)); }
    }
    sorted = [...posts].sort((a, b) => a - b);
    const inOpening = (x0, x1) => ops.some(o => x1 > o.x0 - 2 && x0 < o.x1 + 2);
    // braces + mid rails in bays without openings
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i] + T, b = sorted[i + 1];
      if (b - a < 8) continue;
      if (inOpening(a, b)) {
        // rail under/over each window within this bay
        for (const o of ops) if (o.x1 > a && o.x0 < b && o.y1 < h - 14) beamRect(g, a, o.y1 + 1, b - a, 8, R, beamCol);
        for (const o of ops) if (o.x1 > a && o.x0 < b && o.y0 > 14) beamRect(g, a, o.y0 - 9, b - a, 8, R, beamCol);
        continue;
      }
      const first = i === 0, last = i === sorted.length - 2;
      if (first || last || R() < 0.45) {
        // diagonal brace (Mann figure leaning into the corner)
        if (first) brace(g, a, h - T, b - 4, T + 2, 8, R, beamCol);
        else if (last) brace(g, b - 4, h - T, a, T + 2, 8, R, beamCol);
        else { brace(g, a, h * 0.5, (a + b) / 2, T, 7, R, beamCol); brace(g, b - 3, h * 0.5, (a + b) / 2, T, 7, R, beamCol); }
      }
      beamRect(g, a, h * 0.5 - 4, b - a, 8, R, beamCol);
    }
    for (const x of sorted) beamRect(g, x, 0, T, h, R, beamCol);
    beamRect(g, 0, h - T, w, T, R, beamCol);
    beamRect(g, 0, 0, w, T - 2, R, beamCol);
  }
  // drop shadows + recess darkening around openings (decals sit in front of these)
  for (const o of ops) {
    const grd = g.createLinearGradient(0, o.y1, 0, o.y1 + 14);
    grd.addColorStop(0, 'rgba(20,12,8,0.55)'); grd.addColorStop(1, 'rgba(20,12,8,0)');
    g.fillStyle = grd; g.fillRect(o.x0 + 3, o.y1, o.x1 - o.x0 + 2, 14);
    g.fillStyle = 'rgba(20,12,8,0.35)';
    g.fillRect(o.x1, o.y0 + 4, 5, o.y1 - o.y0);
    g.fillStyle = 'rgba(20,12,8,0.18)';
    g.fillRect(o.x1 + 5, o.y0 + 8, 4, o.y1 - o.y0);
  }
  // rain streaks running down from each sill
  if (style !== 'planks') for (const o of ops) {
    if (o.y1 > h - 10) continue;
    for (let x = Math.round(o.x0 + 2); x < o.x1 - 2; x++) {
      const len = (4 + R() * 18) | 0;
      for (let y = 0; y < len; y++) if (((x + y) & 1) === 0 || y < len * 0.35) { g.fillStyle = 'rgba(40,30,20,0.22)'; g.fillRect(x, Math.round(o.y1 + 3 + y), 1, 1); }
    }
  }
  // baked AO: damp dark base, deep shadow under the eave / jetty
  const base = g.createLinearGradient(0, h, 0, h - PX * 0.75);
  base.addColorStop(0, 'rgba(18,12,10,0.55)'); base.addColorStop(1, 'rgba(18,12,10,0)');
  g.fillStyle = base; g.fillRect(0, h - PX * 0.75, w, PX * 0.75);
  if (opts.topAO !== false) {
    const top = g.createLinearGradient(0, 0, 0, PX * 0.7);
    top.addColorStop(0, 'rgba(14,8,6,0.7)'); top.addColorStop(1, 'rgba(14,8,6,0)');
    g.fillStyle = top; g.fillRect(0, 0, w, PX * 0.7);
  }
  // corner AO
  for (const [x0, dir] of [[0, 1], [w, -1]]) {
    const cg = g.createLinearGradient(x0, 0, x0 + dir * PX * 0.35, 0);
    cg.addColorStop(0, 'rgba(14,8,6,0.35)'); cg.addColorStop(1, 'rgba(14,8,6,0)');
    g.fillStyle = cg; g.fillRect(Math.min(x0, x0 + dir * PX * 0.35), 0, PX * 0.35, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

// Facades get a gentler version of the roof's sky sheen: pale plaster reads as moonlit blue-grey against
// dark timber (the half-timber pattern stays legible on the walls that face away from the moon).
function facadeMat(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float tl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      outgoingLight += vec3(tl) * vec3(0.07, 0.1, 0.16) * smoothstep(0.08, 0.5, tl);
    }
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'facadesheen';
  return m;
}

// A wall plane in house-local space. side: 'f','b','r','l'. y0/hgt in metres, W/D = box extents.
function wallFace(side, W, D, y0, hgt, tex) {
  const fw = (side === 'f' || side === 'b') ? W : D;
  const geo = new THREE.PlaneGeometry(fw, hgt);
  const rot = { f: 0, r: Math.PI / 2, b: Math.PI, l: -Math.PI / 2 }[side];
  geo.rotateY(rot);
  const off = { f: [0, D / 2], b: [0, -D / 2], r: [W / 2, 0], l: [-W / 2, 0] }[side];
  geo.translate(off[0], y0 + hgt / 2, off[1]);
  return mesh(geo, facadeMat(tex));
}

// Painted shingle slope: individual shingles with per-shingle tone, shadow lines under each course,
// a doubled dark eave course, sun-bleached and mossy patches, a darker band under the ridge.
const RPX = 30;   // chunky: one shingle texel stays >= ~1.5 screen px on the back rows of the hero shot
function roofTexture(lenM, slopeM, tint, seed) {
  const w = Math.max(16, Math.round(lenM * RPX)), h = Math.max(16, Math.round(slopeM * RPX));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const R = rng(seed), N = vnoise(R);
  const base = new THREE.Color(tint);
  const br = base.r * 255, bg = base.g * 255, bb = base.b * 255;
  const rowH = 6;
  const img = g.createImageData(w, h), D = img.data;
  const put = (x, y, r, gg, b) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; D[o] = r; D[o + 1] = gg; D[o + 2] = b; D[o + 3] = 255; };
  // canvas y = 0 is the ridge, y = h the eave
  for (let row = 0; row * rowH < h + rowH; row++) {
    const y0 = h - (row + 1) * rowH;          // courses laid from the eave up
    let x = -Math.floor(R() * 10);
    while (x < w) {
      const sw = 4 + Math.floor(R() * 4);
      let k = 0.8 + R() * 0.28;
      const rr = R();
      if (rr < 0.06) k *= 0.6; else if (rr > 0.95) k *= 1.22;
      const mossN = N(x / 30, (y0 + h) / 18) * 0.7 + N(x / 9 + 5, y0 / 7) * 0.3;
      const lowBias = (y0 / h);
      const moss = mossN + lowBias * 0.22 > 0.78;
      const bleach = N(x / 40 + 9, y0 / 30 + 3) > 0.72;
      for (let yy = 0; yy < rowH + 2; yy++) for (let xx = 0; xx < sw; xx++) {
        const px = x + xx, py = y0 + yy;
        let r = br * k, gg = bg * k, b = bb * k;
        // grain streak + bottom-edge highlight + rounded bottom corners
        if ((xx * 5 + row * 3) % 7 === 0) { r *= 0.9; gg *= 0.9; b *= 0.9; }
        if (yy >= rowH) { r *= 1.32; gg *= 1.26; b *= 1.2; }           // lit butt edge of each shingle
        if (xx === 0 && yy >= 2 && yy < rowH) { r *= 1.12; gg *= 1.1; b *= 1.08; }
        if (yy >= rowH + 1 && (xx === 0 || xx === sw - 1)) continue;
        if (yy < 2) { r *= 0.42; gg *= 0.42; b *= 0.48; }   // shadow from the course above
        if (bleach) { r = r * 0.85 + 26; gg = gg * 0.85 + 22; b = b * 0.85 + 18; }
        if (moss && ((px + py) & 1 || mossN > 0.86)) { r = r * 0.45 + 30; gg = gg * 0.55 + 56; b = b * 0.4 + 18; }
        put(px, py, r, gg, b);
      }
      // gap between shingles
      for (let yy = 2; yy < rowH; yy++) put(x + sw - 1, y0 + yy, br * 0.28, bg * 0.25, bb * 0.27);
      x += sw;
    }
  }
  g.putImageData(img, 0, 0);
  // eave course: doubled, darker drip edge; ridge band
  g.fillStyle = 'rgba(20,10,6,0.45)'; g.fillRect(0, h - 3, w, 3);
  g.fillStyle = 'rgba(20,10,6,0.25)'; g.fillRect(0, h - rowH - 2, w, 2);
  const rg = g.createLinearGradient(0, 0, 0, 9);
  rg.addColorStop(0, 'rgba(18,10,8,0.55)'); rg.addColorStop(1, 'rgba(18,10,8,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, 9);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}

// Shingle slopes face away from the moon in the hero shot, so on pure physics they are a dark slab.
// HD-2D keeps them readable: a cool sky sheen proportional to the texel's own value (so the lit shingle
// butts and the dark course shadows keep their contrast) plus a faint moon-silver on the brightest texels.
function roofTopMat(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float tl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      outgoingLight += mix(diffuseColor.rgb, vec3(tl), 0.55) * vec3(0.13, 0.17, 0.26) * 0.9;
      outgoingLight += vec3(0.05, 0.075, 0.12) * smoothstep(0.18, 0.4, tl);
    }
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'roofsheen';
  return m;
}

// Roof with ridge along local x. span = wall depth (z), len = wall width (x)
function roof(len, span, yTop, tint, gableOpts, oh = 0.5, ohEnd = 0.38) {
  const M = materials();
  const g = new THREE.Group();
  const half = span / 2;
  const rise = half * 1.12;
  const a = Math.atan2(rise, half);
  const th = 0.2;
  const slopeLen = (half + oh) / Math.cos(a);
  const edgeCol = new THREE.Color(tint).multiplyScalar(0.42);
  const edgeMat = new THREE.MeshStandardMaterial({ color: edgeCol, roughness: 0.9 });
  const underMat = M.darkBeam;
  for (const side of [1, -1]) {
    const geo = new THREE.BoxGeometry(len + ohEnd * 2, th, slopeLen);
    if (side < 0) geo.rotateY(Math.PI);            // keep v = 0 (canvas bottom = eave) at the low edge
    const tex = roofTexture(len + ohEnd * 2, slopeLen, tint, (gableOpts.seed || 1) * 13 + side * 5 + 101);
    const top = roofTopMat(tex);
    const m = new THREE.Mesh(geo, [edgeMat, edgeMat, top, underMat, edgeMat, edgeMat]);
    m.castShadow = true; m.receiveShadow = true;
    m.rotation.x = side * a;
    const cz = side * (Math.cos(a) * slopeLen / 2);
    const cy = yTop + rise - Math.sin(a) * slopeLen / 2;
    m.position.set(0, cy + th / 2 / Math.cos(a), cz);
    g.add(m);
    // fascia beam along the eave
    const eaveZ = side * (half + oh), eaveY = yTop + rise - Math.tan(a) * (half + oh);
    g.add(box(len + ohEnd * 2, 0.16, 0.16, 0, eaveY - 0.02, eaveZ, M.beam, 1.5));
    // rafter tails under the overhang
    for (let x = -len / 2; x <= len / 2 + 0.01; x += 0.6) {
      const r = box(0.1, 0.12, oh + 0.1, x, 0, 0, M.darkBeam, 1.5);
      r.position.set(0, eaveY + Math.tan(a) * (oh / 2) - 0.1, side * (half + oh / 2 - 0.05));
      g.add(r);
    }
  }
  // ridge: a row of half-round ridge tiles with per-tile tone + end caps
  {
    const L = len + ohEnd * 2 + 0.06, n = Math.max(3, Math.round(L / 0.3));
    const parts = [];
    const R = rng((gableOpts.seed || 3) * 7);
    for (let i = 0; i < n; i++) {
      const cg = new THREE.CylinderGeometry(0.15, 0.15, L / n + 0.02, 7, 1, false, -Math.PI / 2, Math.PI);
      cg.rotateZ(Math.PI / 2);
      cg.translate(-L / 2 + (i + 0.5) * L / n, yTop + rise + 0.1, 0);
      const k = 0.62 + R() * 0.22;
      const col = new Float32Array(cg.attributes.position.count * 3).fill(k);
      // darker joint at each tile end
      for (let v = 0; v < cg.attributes.position.count; v++) { const lx = cg.attributes.position.getX(v) - (-L / 2 + (i + 0.5) * L / n); if (Math.abs(lx) > L / n / 2 - 0.005) { col[v * 3] *= 0.6; col[v * 3 + 1] *= 0.6; col[v * 3 + 2] *= 0.6; } }
      cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(cg);
    }
    const rm = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint), roughness: 0.8, vertexColors: true, flatShading: true });
    g.add(mesh(mergeGeos(parts, true), rm));
    g.add(box(L, 0.1, 0.22, 0, yTop + rise + 0.04, 0, M.darkBeam, 1.5));
  }
  // gable triangles (painted facade) at both ends
  for (const sx of [1, -1]) {
    const x = sx * len / 2;
    const pts = sx > 0
      ? [[x, yTop, half], [x, yTop, -half], [x, yTop + rise, 0]]
      : [[x, yTop, -half], [x, yTop, half], [x, yTop + rise, 0]];
    const uvs = pts.map(p => [(sx > 0 ? (half - p[2]) : (p[2] + half)) / span, (p[1] - yTop) / rise]);
    const tex = facadeTexture(span, rise, gableOpts.style === 'stone' ? 'timber' : gableOpts.style, gableOpts.openings || [], gableOpts.seed + sx * 7, { tone: gableOpts.tone, topAO: false });
    g.add(mesh(triGeometry(pts, uvs), facadeMat(tex)));
    for (const side of [1, -1]) {
      const bl = Math.hypot(half + oh, rise + oh * Math.tan(a));
      const bg = new THREE.BoxGeometry(0.16, 0.24, bl);
      worldUV(bg, 1.5);
      const b = mesh(bg, M.beam);
      b.rotation.x = side * a;
      b.position.set(sx * (len / 2 + ohEnd - 0.04), yTop + rise - Math.sin(a) * bl / 2 + 0.12, side * Math.cos(a) * bl / 2);
      g.add(b);
    }
    // carved finial at the gable apex
    const fin = new THREE.ConeGeometry(0.08, 0.36, 5); fin.translate(sx * (len / 2 + ohEnd - 0.04), yTop + rise + 0.36, 0);
    g.add(mesh(fin, M.darkBeam));
  }
  g.userData.rise = rise;
  return g;
}

function glowWinTop(h) { return h.light ? 4.2 : 2.6; }
function decalW(name, h) { const [w, hh] = size(name); return h * w / hh; }

function buildHouse(h, ctx) {
  const M = materials();
  const g = new THREE.Group();
  const W = h.w, D = h.d;
  const two = h.floors === 2;
  const jet = two ? 0.18 : 0;
  const seed = Math.round(Math.abs(h.x * 131 + h.z * 71)) + 5;
  const R = rng(seed);
  const tones = [[204, 184, 148], [196, 180, 150], [210, 192, 156], [190, 176, 150], [206, 186, 160]];
  const tone = tones[seed % tones.length];
  const beam = [[86, 56, 36], [74, 48, 32], [96, 62, 40]][seed % 3];
  const style1 = h.style === 'stone' ? 'stone' : (h.style === 'planks' ? 'planks' : 'timber');
  const style2 = h.style === 'planks' ? 'planks' : 'timber';
  const winH = 1.28, doorH = 1.78;

  // plinth
  g.add(box(W + 0.26, PLINTH + 0.6, D + 0.26, 0, (PLINTH - 0.6) / 2, 0, M.stone, 1.6, 1.6, null, 0.45));

  // openings per face for the ground floor (face-local metres, from bottom of the wall at PLINTH)
  const op1 = { f: [], b: [], r: [], l: [] };
  const op2 = { f: [], b: [], r: [], l: [] };
  const dw = decalW(h.door, doorH);
  op1.f.push({ u0: W / 2 + h.doorX - dw * 0.42, u1: W / 2 + h.doorX + dw * 0.42, v0: 0, v1: doorH - 0.2 });
  for (const w of h.windows) { const ww = decalW(w.t, winH); op1.f.push({ u0: W / 2 + w.x - ww * 0.45, u1: W / 2 + w.x + ww * 0.45, v0: 0.3, v1: 0.55 + winH - 0.1 }); }
  for (const w of h.back || []) { const ww = decalW(w.t, winH); op1.b.push({ u0: W / 2 - w.x - ww * 0.45, u1: W / 2 - w.x + ww * 0.45, v0: 0.3, v1: 0.55 + winH - 0.1 }); }
  (h.side || []).forEach((t, i) => {
    const zz = (i - ((h.side.length - 1) / 2)) * 1.9;
    const ww = decalW(t, winH);
    op1.r.push({ u0: D / 2 - zz - ww * 0.45, u1: D / 2 - zz + ww * 0.45, v0: 0.3, v1: 0.55 + winH - 0.1 });
    op1.l.push({ u0: zz + D / 2 - ww * 0.45, u1: zz + D / 2 + ww * 0.45, v0: 0.3, v1: 0.55 + winH - 0.1 });
    const wu = decalW('window_lattice', winH * 0.9);
    op2.r.push({ u0: D / 2 + jet - zz - wu * 0.45, u1: D / 2 + jet - zz + wu * 0.45, v0: 0.4, v1: 0.45 + winH * 0.9 - 0.1 });
    op2.l.push({ u0: zz + D / 2 + jet - wu * 0.45, u1: zz + D / 2 + jet + wu * 0.45, v0: 0.4, v1: 0.45 + winH * 0.9 - 0.1 });
  });
  if (two) for (const w of h.upper || []) { const ww = decalW(w.t, winH * 0.92); op2.f.push({ u0: W / 2 + jet + w.x - ww * 0.45, u1: W / 2 + jet + w.x + ww * 0.45, v0: 0.4, v1: 0.45 + winH * 0.92 - 0.1 }); }

  // ground-floor walls
  for (const s of ['f', 'b', 'r', 'l']) {
    const fw = (s === 'f' || s === 'b') ? W : D;
    const tex = facadeTexture(fw, F1, style1, op1[s], seed + s.charCodeAt(0), { tone, beam });
    g.add(wallFace(s, W, D, PLINTH, F1, tex));
  }
  let yTop = PLINTH + F1;
  // floor beam / jetty
  g.add(box(W + 0.3 + jet * 2, 0.22, D + 0.3 + jet * 2, 0, yTop + 0.02, 0, M.beam, 1.5));
  if (two) {
    // jetty brackets
    for (const x of [-W / 2 + 0.3, W / 2 - 0.3, ...(W > 5.5 ? [0] : [])]) {
      const br = box(0.14, 0.4, 0.3, x, yTop - 0.24, D / 2 + 0.08, M.darkBeam, 1.5);
      g.add(br);
    }
    for (const s of ['f', 'b', 'r', 'l']) {
      const fw = (s === 'f' || s === 'b') ? W + jet * 2 : D + jet * 2;
      const tex = facadeTexture(fw, F2, style2, op2[s], seed + 50 + s.charCodeAt(0), { tone, beam });
      g.add(wallFace(s, W + jet * 2, D + jet * 2, yTop + 0.12, F2, tex));
    }
    yTop += 0.12 + F2;
  }
  const Wt = W + jet * 2, Dt = D + jet * 2;
  g.add(box(Wt + 0.24, 0.18, Dt + 0.24, 0, yTop, 0, M.beam, 1.5));
  // roof (gable openings: the upper lattice window of a 1-floor gable-front house)
  let r;
  const gableOps = [];
  if (!two && h.gableFront && (h.upper || []).length) {
    const ww = decalW('window_lattice', winH * 0.8);
    gableOps.push({ u0: Wt / 2 - ww * 0.45, u1: Wt / 2 + ww * 0.45, v0: 0.15, v1: 0.15 + winH * 0.8 - 0.1 });
  }
  const gOpts = { style: h.style === 'planks' ? 'planks' : 'timber', tone, seed: seed + 99, openings: gableOps };
  if (h.gableFront) { r = roof(Dt, Wt, yTop + 0.06, h.roof, gOpts); r.rotation.y = Math.PI / 2; }
  else r = roof(Wt, Dt, yTop + 0.06, h.roof, { ...gOpts, openings: [] });
  g.add(r);
  const rise = r.userData.rise;
  // attic window in the front gable (two-storey gable-front houses that face the plaza): a lit pane
  // high on the facade so the back row of the village carries readable window light up into the roofs
  if (two && h.gableFront && Math.abs(h.rot) < 0.5) {
    const aw = makeDecal('window_lattice', winH * 0.62, { emissive: true, emissiveIntensity: glowWinTop(h), emissiveOpts: { threshold: 0.5 }, castShadow: false });
    aw.position.set(0, yTop + 0.42, Dt / 2 + 0.07);
    g.add(aw);
    ctx.halos.push({ obj: aw, y: aw.position.y + winH * 0.31, strength: h.light ? 0.85 : 0.5, size: 1.0 });
  }
  // chimney
  if (h.chimney) {
    const [cx, cz] = h.chimney;
    const ch = rise + 1.5;
    g.add(box(0.8, ch, 0.8, cx, yTop + ch / 2 + 0.2, cz, M.stone, 1.4, 1.4, null, 0.7));
    g.add(box(0.98, 0.16, 0.98, cx, yTop + ch + 0.24, cz, M.stone, 1.4));
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.5), M.chimneyTop);
    top.position.set(cx, yTop + ch + 0.33, cz);
    g.add(top);
    ctx.chimneys.push({ house: h, local: new THREE.Vector3(cx, yTop + ch + 0.4, cz) });
  }
  // lean-to shed on one side
  if (h.lean) {
    const sx = h.lean, lw = 1.7, ld = D * 0.7, lh = 1.9;
    const x = sx * (W / 2 + lw / 2);
    const sg = new THREE.BoxGeometry(lw, lh, ld, 1, 2, 1); sg.translate(x, PLINTH + lh / 2 - 0.1, -D * 0.1);
    worldUV(sg, 1.6); heightAO(sg, PLINTH, PLINTH + lh, 0.45);
    g.add(mesh(sg, M.planks));
    const rg = new THREE.BoxGeometry(lw + 0.5, 0.14, ld + 0.6);
    worldUV(rg, 1.45, 1.45);
    const rm = mesh(rg, roofMat(h.roof));
    rm.rotation.z = -sx * 0.42;
    rm.position.set(x + sx * 0.1, PLINTH + lh + 0.28, -D * 0.1);
    g.add(rm);
    // stacked firewood against the shed
    const wood = box(1.1, 0.7, 0.36, x, PLINTH + 0.25, -D * 0.1 + ld / 2 + 0.2, M.darkBeam, 0.5);
    g.add(wood);
  }

  // ---- decals (shadow-casting, held slightly off the wall) ----
  const front = D / 2 + 0.06;
  const glowWin = !!h.light;
  const addHalo = (obj, y, strength, sz) => ctx.halos.push({ obj, y, strength, size: sz });
  const door = makeDecal(h.door, doorH, { emissive: h.door === 'door_oak', emissiveIntensity: 4, emissiveOpts: { threshold: 0.55, region: [0, 0.45] }, castShadow: true });
  door.position.set(h.doorX, -0.04, front + 0.02);
  g.add(door);
  // stone door step
  g.add(box(dw * 0.75, 0.16, 0.5, h.doorX, -0.02, D / 2 + 0.3, M.stone, 1.2));
  if (h.door === 'door_oak') addHalo(door, 1.35, 0.6, 0.9);
  const winOpts = (t) => ({ emissive: true, emissiveIntensity: glowWin ? 4.0 : 2.6, emissiveOpts: { threshold: t === 'window_lattice' ? 0.5 : 0.52 }, castShadow: true });
  for (const w of h.windows) {
    const d = makeDecal(w.t, winH, winOpts(w.t));
    d.position.set(w.x, PLINTH + 0.55, front);
    g.add(d);
    addHalo(d, PLINTH + 0.55 + winH * 0.55, glowWin ? 1 : 0.6, 1.4);
  }
  for (const w of h.back || []) {
    const d = makeDecal(w.t, winH, winOpts(w.t));
    d.rotation.y = Math.PI;
    d.position.set(w.x, PLINTH + 0.55, -front);
    g.add(d);
    if (two) {
      const u = makeDecal('window_lattice', winH * 0.9, winOpts('window_lattice'));
      u.rotation.y = Math.PI; u.position.set(w.x * 0.8, PLINTH + F1 + 0.55, -(D / 2 + jet + 0.06));
      g.add(u);
    }
  }
  for (const w of h.upper || []) {
    const d = makeDecal(w.t, winH * (two ? 0.92 : 0.8), winOpts(w.t));
    if (two) d.position.set(w.x, PLINTH + F1 + 0.12 + 0.4, D / 2 + jet + 0.06);
    else if (h.gableFront) d.position.set(w.x, yTop + 0.2, D / 2 + jet + 0.06);
    else continue;
    g.add(d);
    addHalo(d, d.position.y + winH * 0.5, glowWin ? 0.9 : 0.55, 1.2);
  }
  (h.side || []).forEach((t, i) => {
    for (const sx of [1, -1]) {
      const d = makeDecal(t, winH, winOpts(t));
      d.rotation.y = sx * Math.PI / 2;
      const zz = (i - ((h.side.length - 1) / 2)) * 1.9;
      d.position.set(sx * (W / 2 + 0.06), PLINTH + 0.55, zz);
      g.add(d);
      addHalo(d, PLINTH + 0.55 + winH * 0.55, 0.5, 1.2);
      if (two) {
        const u = makeDecal('window_lattice', winH * 0.9, winOpts('window_lattice'));
        u.rotation.y = sx * Math.PI / 2;
        u.position.set(sx * (Wt / 2 + 0.06), PLINTH + F1 + 0.12 + 0.4, zz);
        g.add(u);
      }
    }
  });
  if (h.sign) {
    const s = makeDecal('sign_bakery', 1.25, { castShadow: true });
    s.position.set(-0.35, PLINTH + 1.62, front + 0.3);
    g.add(s);
  }

  // rain barrel + crate at the front corner away from the door (house-local, on the ground)
  {
    const sx = h.doorX > 0 ? -1 : 1;
    const bxp = sx * (W / 2 - 0.35), bzp = D / 2 + 0.42;
    const b = makeSprite(pxName('barrel', 0.78), { h: 0.78, yaw: ctx.yaw - h.rot, flip: R() < 0.5, selfLight: 0.05 });
    b.position.set(bxp, -0.02, bzp); g.add(b);
    const c = makeSprite(pxName('crate', 0.55), { h: 0.55, yaw: ctx.yaw - h.rot, flip: R() < 0.5, selfLight: 0.05 });
    c.position.set(bxp - sx * 0.62, -0.02, bzp + 0.12); g.add(c);
  }
  // bell tower: tall stone shaft, glowing belfry, steep four-sided spire with a finial
  if (h.tower) {
    const tx = h.tower, TW = 2.5, TH = 9.2;
    g.add(box(TW + 0.3, PLINTH + 0.6, TW + 0.3, tx, (PLINTH - 0.6) / 2, -0.3, M.stone, 1.6, 1.6, null, 0.45));
    g.add(box(TW, TH, TW, tx, PLINTH + TH / 2, -0.3, M.stone, 1.6, 1.6, null, 0.4));
    // string courses
    for (const yy of [3.4, 6.6]) g.add(box(TW + 0.18, 0.18, TW + 0.18, tx, PLINTH + yy, -0.3, M.stone, 1.2));
    g.add(box(TW + 0.34, 0.3, TW + 0.34, tx, PLINTH + TH, -0.3, M.stone, 1.2));
    for (const fz of [1, -1]) {
      const bw = makeDecal('window_lattice', 1.2, { emissive: true, emissiveIntensity: 4.2, emissiveOpts: { threshold: 0.5 }, castShadow: false });
      if (fz < 0) bw.rotation.y = Math.PI;
      bw.position.set(tx, PLINTH + 7.35, -0.3 + fz * (TW / 2 + 0.05));
      g.add(bw);
      addHalo(bw, PLINTH + 8.0, 1.1, 1.8);
    }
    const lw = makeDecal('window_shutter', 1.0, winOpts('window_shutter'));
    lw.position.set(tx, PLINTH + 4.2, -0.3 + TW / 2 + 0.05);
    g.add(lw);
    addHalo(lw, PLINTH + 4.7, 0.7, 1.2);
    const spH = 5.2;
    const sp = new THREE.ConeGeometry((TW + 0.7) * 0.7071, spH, 4, 1);
    sp.rotateY(Math.PI / 4);
    worldUV(sp, 1.2, 1.2, [0, 0, 0]);
    const spire = mesh(sp, roofMat(h.roof));
    spire.position.set(tx, PLINTH + TH + 0.15 + spH / 2, -0.3);
    g.add(spire);
    g.add(box(0.12, 1.1, 0.12, tx, PLINTH + TH + spH + 0.5, -0.3, M.darkBeam, 0.5));
    g.add(box(0.6, 0.12, 0.12, tx, PLINTH + TH + spH + 0.75, -0.3, M.darkBeam, 0.5));
  }

  // contact AO under the house
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(W + 2.6, D + 2.6), new THREE.MeshBasicMaterial({
    map: radialTex(), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  ao.material.alphaMap = radialTex();
  ao.rotation.x = -Math.PI / 2; ao.position.y = 0.025; ao.renderOrder = 1;
  g.add(ao);

  g.position.set(h.x, h.level * TIER, h.z);
  g.rotation.y = h.rot;
  g.userData.house = h;
  return g;
}

export function buildBuildings(ctx) {
  const group = new THREE.Group();
  ctx.chimneys = [];
  for (const h of HOUSES) {
    const hg = buildHouse(h, ctx);
    group.add(hg);
    h.group = hg;
  }
  ctx.scene.add(group);
  group.updateMatrixWorld(true);
  return group;
}
