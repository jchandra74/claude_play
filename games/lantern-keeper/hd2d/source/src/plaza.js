// Plaza dressing built from geometry: two different market stalls, hand carts with produce,
// benches, a raised stone curb round the dais, banner poles with bunting, a laundry line,
// the foreground parapet + fence that frames the bottom of the hero shot, and festoon string
// lights that sag between the Great Lantern, the stalls and the house eaves.
import * as THREE from 'three';
import { tileTex, makeSprite } from './assets.js';
import { pxName, blobShadow } from './props.js';
import { worldUV, mergeGeos, heightAO } from './geom.js';
import { groundY } from './terrain.js';
import { GREAT_LANTERN_LIGHT, rng, TIER } from './layout.js';

function stripeTex(c1, c2, scallop = true) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 16;
  const g = c.getContext('2d');
  for (let x = 0; x < 32; x++) {
    g.fillStyle = (Math.floor(x / 4) % 2) ? c1 : c2; g.fillRect(x, 0, 1, 16);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, 32, 2);
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 6, 32, 1);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 12, 32, 3);
  if (scallop) for (let x = 0; x < 32; x += 4) { g.clearRect(x, 15, 1, 1); g.clearRect(x + 3, 15, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function burlapTex() {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 150 + ((x + y) % 2) * 18 + ((x * 7 + y * 13) % 5) * 5 - (y > 12 ? 30 : 0);
    g.fillStyle = `rgb(${v},${v * 0.82 | 0},${v * 0.6 | 0})`; g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = 'rgb(110,80,52)'; g.fillRect(0, 7, 16, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2);
  return t;
}

let M = null;
function mats() {
  if (M) return M;
  const planks = tileTex('tex_planks'), stone = tileTex('tex_stonebrick');
  M = {
    wood: new THREE.MeshStandardMaterial({ map: planks, color: 0x8a6448, roughness: 0.9, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ map: planks, color: 0x5a3c28, roughness: 0.9, vertexColors: true }),
    fence: new THREE.MeshStandardMaterial({ map: planks, color: 0x93694a, roughness: 0.95, vertexColors: true }),
    stone: new THREE.MeshStandardMaterial({ map: stone, color: new THREE.Color(1.15, 1.08, 1.0), roughness: 0.9, vertexColors: true }),
    sack: new THREE.MeshStandardMaterial({ map: burlapTex(), color: 0xc8b088, roughness: 1 }),
    pumpkin: new THREE.MeshStandardMaterial({ color: 0xd2722a, roughness: 0.8, flatShading: true }),
    apple: new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6, flatShading: true }),
    cabbage: new THREE.MeshStandardMaterial({ color: 0x7aa04a, roughness: 0.9, flatShading: true }),
    bread: new THREE.MeshStandardMaterial({ color: 0xc8904e, roughness: 0.8, flatShading: true }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.6, metalness: 0.3 }),
    cartWood: new THREE.MeshStandardMaterial({ map: planks, color: 0xc08a5e, roughness: 0.9, vertexColors: true }),
    cartDark: new THREE.MeshStandardMaterial({ map: planks, color: 0x8a5e3e, roughness: 0.9, vertexColors: true }),
  };
  return M;
}

function m(geo, mat) { const o = new THREE.Mesh(geo, mat); o.castShadow = true; o.receiveShadow = true; return o; }
function bx(w, h, d, x, y, z, mat, aoBase = 0.6, tile = 1.2) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1); g.translate(x, y, z); worldUV(g, tile);
  heightAO(g, y - h / 2 - 0.1, y + h / 2, aoBase);
  return m(g, mat);
}
function place(ctx, g, x, z, rot, dy = 0) {
  g.position.set(x, groundY(x, z) + dy, z); g.rotation.y = rot; ctx.scene.add(g); g.updateMatrixWorld(true); return g;
}
function spriteAt(ctx, g, name, lx, ly, lz, h, extra = {}) {
  const s = makeSprite(pxName(name, h), { h, yaw: ctx.yaw, ...extra });
  const p = new THREE.Vector3(lx, ly, lz); g.localToWorld(p);
  s.position.copy(p); ctx.scene.add(s); return s;
}

function produce(g, x, y, z, kind, R, n = 7) {
  const MM = mats();
  const mat = MM[kind];
  const r = kind === 'apple' ? 0.07 : (kind === 'pumpkin' ? 0.16 : (kind === 'bread' ? 0.1 : 0.12));
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.8 + R() * 0.4), 0), mat);
    s.scale.y = kind === 'pumpkin' ? 0.7 : (kind === 'bread' ? 0.55 : 0.9); if (kind === 'bread') s.scale.x = 1.5;
    s.position.set(x + (R() - 0.5) * 0.5, y + r * 0.7 + (i > n * 0.6 ? r * 1.1 : 0), z + (R() - 0.5) * 0.3);
    s.castShadow = true; s.receiveShadow = true;
    g.add(s);
  }
}

function sack(g, x, y, z, R) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mats().sack);
  s.scale.set(1, 1.25 + R() * 0.2, 0.85); s.position.set(x, y + 0.27, z); s.rotation.y = R() * 3;
  s.castShadow = s.receiveShadow = true; g.add(s);
  const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.12, 5), mats().sack);
  tie.position.set(x, y + 0.6, z); g.add(tie);
}

// Market stall. kind 'flat' = sloped striped awning; 'gable' = peaked cloth roof.
function stall(ctx, x, z, rot, colors, kind, goods) {
  const MM = mats();
  const g = new THREE.Group();
  const R = rng(Math.floor(Math.abs(x * 100 + z * 7)));
  const W = kind === 'gable' ? 2.3 : 2.7, D = 1.3;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const hh = kind === 'gable' ? 2.1 : (sz < 0 ? 2.4 : 2.0);
    g.add(bx(0.12, hh, 0.12, sx * W / 2, hh / 2, sz * D / 2, MM.dark, 0.5));
  }
  g.add(bx(W, 0.85, D * 0.8, 0, 0.425, 0.05, MM.wood, 0.45));
  g.add(bx(W + 0.1, 0.06, D * 0.86, 0, 0.88, 0.05, MM.dark, 1));
  // back shelf with goods
  g.add(bx(W - 0.2, 0.06, 0.35, 0, 1.35, -D / 2 + 0.2, MM.dark, 1));
  const tex = stripeTex(colors[0], colors[1]);
  const cloth = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.5 });
  if (kind === 'gable') {
    tex.repeat.set(W / 0.9, 1);
    for (const s of [1, -1]) {
      const p = m(new THREE.PlaneGeometry(W + 0.4, 1.05), cloth);
      p.rotation.order = 'YXZ';
      p.rotation.x = -Math.PI / 2 + s * 0.62 * -1 * -1;
      p.rotation.x = s > 0 ? -0.95 : -Math.PI + 0.95;
      p.position.set(0, 2.42, s * 0.4);
      g.add(p);
    }
    const ridge = bx(W + 0.5, 0.08, 0.08, 0, 2.78, 0, MM.dark, 1);
    g.add(ridge);
  } else {
    tex.repeat.set(W / 0.9, 1);
    const a = m(new THREE.PlaneGeometry(W + 0.5, D + 0.6), cloth);
    a.rotation.x = -Math.PI / 2 + 0.32;
    a.position.set(0, 2.2, 0.02);
    g.add(a);
    const val = m(new THREE.PlaneGeometry(W + 0.5, 0.32), cloth);
    val.position.set(0, 1.92, (D + 0.6) / 2 * Math.cos(0.32) + 0.02);
    g.add(val);
  }
  place(ctx, g, x, z, rot);
  // goods: produce piles on the counter + crates/barrels
  produce(g, -0.75, 0.91, 0.1, goods[0], R, 8);
  produce(g, 0.15, 0.91, 0.12, goods[1], R, 6);
  spriteAt(ctx, g, R() < 0.5 ? 'barrel' : 'crate', 0.9, 0.91, 0.05, 0.42);
  spriteAt(ctx, g, 'crate', -W / 2 - 0.35, 0, 0.35, 0.55);
  sack(g, W / 2 + 0.35, 0, 0.3, R);
  sack(g, W / 2 + 0.3, 0, -0.25, R);
  produce(g, 0.5, 1.38, -D / 2 + 0.2, goods[2] || goods[0], R, 5);
  return g;
}

function cart(ctx, x, z, rot, load) {
  const MM = mats();
  const g = new THREE.Group();
  const R = rng(Math.floor(Math.abs(x * 31 + z * 17)));
  const body = MM.cartWood, dark = MM.cartDark;
  g.add(bx(1.7, 0.1, 1.0, 0, 0.62, 0, body, 0.8));
  for (const s of [-1, 1]) {
    g.add(bx(1.7, 0.32, 0.06, 0, 0.82, s * 0.48, body, 0.7));
    g.add(bx(0.06, 0.32, 1.0, s * 0.84, 0.82, 0, body, 0.7));
    // wheels: rim touches the ground (sunk 1 cm) on an axle under the bed
    const wg = new THREE.CylinderGeometry(0.43, 0.43, 0.08, 14); wg.rotateX(Math.PI / 2);
    const w = m(wg, dark); w.position.set(-0.2, 0.42, s * 0.56); g.add(w);
    const hub = m(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6).rotateX(Math.PI / 2), MM.iron); hub.position.set(-0.2, 0.42, s * 0.6); g.add(hub);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 4, 14), MM.iron); rim.position.set(-0.2, 0.42, s * 0.56); g.add(rim);
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.BoxGeometry(0.05, 0.8, 0.04); sp.rotateZ(k * Math.PI / 3); sp.translate(-0.2, 0.42, s * 0.56);
      worldUV(sp, 1.2); heightAO(sp, -10, -9, 1); g.add(m(sp, dark));
    }
    // shafts run from the bed down to the cobbles (cart parked, shafts resting on the ground)
    const shg = new THREE.BoxGeometry(1.55, 0.07, 0.07); shg.rotateZ(-0.36); shg.translate(1.55, 0.33, s * 0.32);
    worldUV(shg, 1.2); heightAO(shg, -10, -9, 1); g.add(m(shg, dark));
  }
  g.add(bx(0.07, 0.07, 0.7, 1.15, 0.47, 0, dark, 1));
  g.add(bx(1.0, 0.07, 0.07, -0.2, 0.42, 0, MM.iron, 1));
  if (load === 'pumpkin') produce(g, -0.2, 0.67, 0, 'pumpkin', R, 9);
  else if (load === 'sacks') { sack(g, -0.4, 0.67, -0.15, R); sack(g, 0.1, 0.67, 0.15, R); sack(g, -0.1, 0.9, -0.05, R); }
  else produce(g, 0, 0.67, 0, 'cabbage', R, 10);
  place(ctx, g, x, z, rot, -0.01);
  // contact shadows: under the bed, at each wheel and at the shaft tips
  const y = groundY(x, z);
  const toW = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(x, 0, z));
  const c0 = toW(0, 0); ctx.scene.add(blobShadow(c0.x, y, c0.z, 1.05, 0.7, 0.5));
  for (const s of [-1, 1]) {
    const p = toW(-0.2, s * 0.56); ctx.scene.add(blobShadow(p.x, y, p.z, 0.24, 0.16, 0.85));
    const q = toW(2.25, s * 0.32); ctx.scene.add(blobShadow(q.x, y, q.z, 0.14, 0.1, 0.8));
  }
  return g;
}

function bench(ctx, x, z, rot) {
  const MM = mats();
  const g = new THREE.Group();
  g.add(bx(1.7, 0.08, 0.42, 0, 0.46, 0, MM.wood, 1));
  g.add(bx(1.7, 0.3, 0.06, 0, 0.78, -0.2, MM.wood, 1));
  for (const sx of [-0.7, 0.7]) {
    g.add(bx(0.08, 0.46, 0.38, sx, 0.23, 0, MM.dark, 0.5));
    g.add(bx(0.06, 0.5, 0.06, sx, 0.7, -0.2, MM.dark, 1));
  }
  place(ctx, g, x, z, rot);
}

// ---------------- small pixel textures for the clutter ----------------
function pixTex(w, h, paint, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); paint(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(...repeat);
  return t;
}
const P = (g, x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
let CM = null;
function clutterMats() {
  if (CM) return CM;
  const R = rng(321);
  const terracotta = pixTex(32, 20, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = R() * 14 - 7 + (y < 4 ? 26 : 0) - (y === 4 ? 40 : 0) - (y > h - 4 ? 22 : 0);
      g.fillStyle = `rgb(${186 + v | 0},${96 + v * 0.7 | 0},${58 + v * 0.5 | 0})`; g.fillRect(x, y, 1, 1);
    }
    for (let x = 0; x < w; x += 3) P(g, x, 1, 'rgb(230,150,100)');
    for (let k = 0; k < 10; k++) P(g, (R() * w) | 0, 6 + ((R() * 10) | 0), 'rgb(120,70,48)');
  });
  const wicker = pixTex(32, 12, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const on = ((x >> 1) + (y >> 1)) % 2;
      const v = on ? 30 : 0;
      g.fillStyle = `rgb(${150 + v},${110 + v * 0.8 | 0},${60 + v * 0.5 | 0})`; g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = 'rgb(196,156,96)'; g.fillRect(0, 0, w, 2);
    g.fillStyle = 'rgb(90,62,34)'; g.fillRect(0, h - 1, w, 1);
  });
  const bark = pixTex(16, 16, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = R() * 26 - 13 + ((x % 4) === 0 ? -16 : 0); g.fillStyle = `rgb(${92 + v | 0},${64 + v | 0},${42 + v * 0.6 | 0})`; g.fillRect(x, y, 1, 1); }
  });
  const endGrain = pixTex(12, 12, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 5.5, y - 5.5);
      const ring = Math.floor(d * 0.9) % 2;
      g.fillStyle = d > 5.4 ? 'rgb(90,62,40)' : (ring ? 'rgb(214,170,112)' : 'rgb(190,146,92)'); g.fillRect(x, y, 1, 1);
    }
  });
  const straw = pixTex(32, 32, (g, w, h) => {
    g.fillStyle = 'rgb(196,160,84)'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 160; k++) { const x = (R() * w) | 0, y = (R() * h) | 0, l = 2 + ((R() * 5) | 0); g.fillStyle = R() < 0.5 ? 'rgb(232,200,120)' : 'rgb(150,116,56)'; g.fillRect(x, y, l, 1); }
    g.fillStyle = 'rgb(110,74,40)'; g.fillRect(0, 9, w, 1); g.fillRect(0, 22, w, 1);
  });
  const soil = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 1 });
  CM = {
    pot: new THREE.MeshStandardMaterial({ map: terracotta, roughness: 0.9 }),
    wicker: new THREE.MeshStandardMaterial({ map: wicker, roughness: 1 }),
    bark: new THREE.MeshStandardMaterial({ map: bark, roughness: 1 }),
    grain: new THREE.MeshStandardMaterial({ map: endGrain, roughness: 1 }),
    straw: new THREE.MeshStandardMaterial({ map: straw, roughness: 1 }),
    soil,
    glass: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 2.3, 0.9), fog: false }),
  };
  return CM;
}

// terracotta pot with a pixel plant (tinted) growing out of it
function pot(ctx, x, z, size = 1, plant = 'flowers', tint = null, flip = false) {
  const C = clutterMats();
  const y = groundY(x, z);
  const h = 0.34 * size, rt = 0.2 * size, rb = 0.14 * size;
  const pg = new THREE.CylinderGeometry(rt, rb, h, 10, 1, true);
  const pm = m(pg, C.pot); pm.position.set(x, y + h / 2, z); ctx.scene.add(pm);
  const rim = m(new THREE.TorusGeometry(rt, 0.03 * size, 4, 12).rotateX(Math.PI / 2), C.pot); rim.position.set(x, y + h, z); ctx.scene.add(rim);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(rt * 0.95, 10).rotateX(-Math.PI / 2), C.soil); soil.position.set(x, y + h - 0.04, z); ctx.scene.add(soil);
  const ph = (plant === 'bush' ? 0.62 : 0.46) * size;
  const s = makeSprite(pxName(plant, ph), { h: ph, yaw: ctx.yaw, flip, tint, selfLight: 0.06, castShadow: true });
  s.position.set(x, y + h - 0.06, z + 0.01); ctx.scene.add(s);
  ctx.scene.add(blobShadow(x, y, z + 0.02, rt * 1.5, rt * 1.0, 0.75));
}

// wooden planter trough full of tinted flowers / greens
function flowerBox(ctx, x, z, len, rot, tints) {
  const MM = mats();
  const g = new THREE.Group();
  g.add(bx(len, 0.34, 0.42, 0, 0.17, 0, MM.wood, 0.5));
  g.add(bx(len + 0.08, 0.06, 0.48, 0, 0.36, 0, MM.dark, 1));
  place(ctx, g, x, z, rot);
  const y = groundY(x, z);
  const n = Math.max(2, Math.round(len / 0.42));
  const R = rng(Math.floor(Math.abs(x * 97 + z * 13)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const lx = t * len * 0.92, kind = R() < 0.72 ? 'flowers' : 'bush';
    const ph = kind === 'bush' ? 0.5 + R() * 0.14 : 0.5 + R() * 0.12;
    const s = makeSprite(pxName(kind, ph), { h: ph, yaw: ctx.yaw, flip: R() < 0.5, tint: tints[i % tints.length], selfLight: 0.07, castShadow: false });
    s.position.set(x + Math.cos(rot) * lx, y + 0.32, z - Math.sin(rot) * lx + 0.02);
    ctx.scene.add(s);
  }
  ctx.scene.add(blobShadow(x, y, z + 0.05, len * 0.62, 0.38, 0.7));
}

function basket(ctx, x, z, load, R) {
  const C = clutterMats();
  const g = new THREE.Group();
  const b = m(new THREE.CylinderGeometry(0.27, 0.21, 0.24, 10, 1, true), C.wicker); b.position.y = 0.12; g.add(b);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.25, 10).rotateX(-Math.PI / 2), C.soil); inner.position.y = 0.16; g.add(inner);
  produce(g, 0, 0.12, 0, load, R, load === 'pumpkin' ? 3 : 7);
  place(ctx, g, x, z, R() * 3);
  ctx.scene.add(blobShadow(x, groundY(x, z), z + 0.02, 0.36, 0.26, 0.75));
}

function logPile(ctx, x, z, rot, rows = 3, len = 0.9) {
  const C = clutterMats();
  const g = new THREE.Group();
  const r = 0.085;
  for (let row = 0; row < rows; row++) for (let k = 0; k < rows + 1 - row; k++) {
    const lg = new THREE.CylinderGeometry(r, r, len * (0.9 + ((k * 7 + row * 3) % 5) * 0.03), 7);
    lg.rotateZ(Math.PI / 2);
    const o = new THREE.Mesh(lg, [C.bark, C.grain, C.grain]); o.castShadow = o.receiveShadow = true;
    o.rotation.y = Math.PI / 2;
    o.position.set((k - (rows - row) / 2) * r * 2.05, r + row * r * 1.75, 0);
    g.add(o);
  }
  place(ctx, g, x, z, rot);
  ctx.scene.add(blobShadow(x, groundY(x, z), z + 0.03, rows * r * 1.6, len * 0.55, 0.7));
}

function hayBale(ctx, x, z, rot) {
  const C = clutterMats();
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.9, 0.46, 0.55); geo.translate(0, 0.23, 0); worldUV(geo, 0.6);
  g.add(m(geo, C.straw));
  place(ctx, g, x, z, rot);
  ctx.scene.add(blobShadow(x, groundY(x, z), z + 0.03, 0.6, 0.42, 0.7));
}

function crateStack(ctx, x, z, n, R) {
  const y = groundY(x, z);
  let top = y;
  for (let i = 0; i < n; i++) {
    const h = i === 0 ? 0.62 + R() * 0.12 : 0.48 + R() * 0.1;
    const name = (i === n - 1 && R() < 0.4) ? 'barrel' : 'crate';
    const s = makeSprite(pxName(name, h), { h, yaw: ctx.yaw, flip: R() < 0.5, selfLight: 0.05 });
    s.position.set(x + (R() - 0.5) * 0.08, top - (i ? 0.03 : 0), z + i * 0.02);
    ctx.scene.add(s);
    top += h * 0.92;
  }
  ctx.scene.add(blobShadow(x, y, z + 0.03, 0.45, 0.3, 0.75));
}

// iron wall lantern on a bracket; registers itself as a lamp for the lighting pass
function sconce(ctx, x, y, z, nx, nz) {
  const MM = mats(), C = clutterMats();
  const g = new THREE.Group();
  const arm = new THREE.BoxGeometry(0.06, 0.06, 0.42); arm.translate(0, 0.32, 0.2); g.add(m(arm, MM.iron));
  const brace = new THREE.BoxGeometry(0.04, 0.04, 0.36); brace.rotateX(0.7); brace.translate(0, 0.17, 0.12); g.add(m(brace, MM.iron));
  const cage = new THREE.CylinderGeometry(0.11, 0.09, 0.26, 6); cage.translate(0, 0.08, 0.4); g.add(m(cage, MM.iron));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.2, 6).translate(0, 0.08, 0.4), C.glass); g.add(glass);
  const cap = new THREE.ConeGeometry(0.15, 0.14, 6); cap.translate(0, 0.27, 0.4); g.add(m(cap, MM.iron));
  g.position.set(x, y, z); g.rotation.y = Math.atan2(nx, nz);
  ctx.scene.add(g);
  const p = new THREE.Vector3(x + nx * 0.42, y + 0.1, z + nz * 0.42);
  if (ctx.lamps) ctx.lamps.push({ x: p.x, y: p.y, z: p.z, sprite: glass });
  return p;
}

// 3D post-and-rail fence along a polyline (used for the near-camera foreground silhouette).
function fence3D(ctx, pts, h = 1.0) {
  const geos = [];
  const R = rng(77);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.6));
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = groundY(x, z);
      const ph = h + (R() - 0.5) * 0.14;
      const p = new THREE.BoxGeometry(0.14, ph, 0.14, 1, 2, 1); p.rotateY(R() * 0.3); p.translate(x, y + ph / 2, z);
      worldUV(p, 1.2); heightAO(p, y, y + ph, 0.45); geos.push(p);
      if (k < n) {
        const xm = x0 + (x1 - x0) * (k + 0.5) / n, zm = z0 + (z1 - z0) * (k + 0.5) / n, ym = groundY(xm, zm);
        for (const ry of [0.38, 0.75]) {
          const r = new THREE.BoxGeometry(len / n + 0.1, 0.09, 0.06);
          r.rotateZ((R() - 0.5) * 0.05); r.rotateY(-ang); r.translate(xm, ym + ry * h, zm);
          worldUV(r, 1.2); heightAO(r, -10, -9, 1); geos.push(r);
        }
      }
    }
  }
  const o = m(mergeGeos(geos, true), mats().fence);
  ctx.scene.add(o);
}

// Low stone parapet along a polyline with coping.
function parapet(ctx, pts, h = 0.55) {
  const geos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, y = groundY(xm, zm);
    const w = new THREE.BoxGeometry(len, h, 0.36, 1, 2, 1); w.rotateY(-ang); w.translate(xm, y + h / 2, zm);
    worldUV(w, 1.6); heightAO(w, y, y + h, 0.5); geos.push(w);
    const c = new THREE.BoxGeometry(len + 0.1, 0.1, 0.46); c.rotateY(-ang); c.translate(xm, y + h + 0.05, zm);
    worldUV(c, 1.2); heightAO(c, -10, -9, 1.15); geos.push(c);
  }
  ctx.scene.add(m(mergeGeos(geos, true), mats().stone));
}

function banner(ctx, x, z, colA, colB, h = 3.6) {
  const MM = mats();
  const g = new THREE.Group();
  g.add(bx(0.1, h, 0.1, 0, h / 2, 0, MM.dark, 0.6));
  g.add(bx(0.9, 0.06, 0.06, 0.38, h - 0.15, 0, MM.dark, 1));
  const c = document.createElement('canvas'); c.width = 12; c.height = 28;
  const q = c.getContext('2d');
  q.fillStyle = colA; q.fillRect(0, 0, 12, 24);
  q.fillStyle = colB; q.fillRect(0, 2, 12, 2); q.fillRect(4, 8, 4, 8); q.fillRect(2, 10, 8, 4);
  q.fillStyle = 'rgba(0,0,0,0.25)'; q.fillRect(10, 0, 2, 24);
  q.fillStyle = colA; for (let i = 0; i < 6; i++) q.fillRect(i, 24 + Math.min(i, 3), 1, 4 - Math.min(i, 3)); for (let i = 6; i < 12; i++) q.fillRect(i, 24 + Math.min(11 - i, 3), 1, 4 - Math.min(11 - i, 3));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  const cloth = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 1 });
  const p = m(new THREE.PlaneGeometry(0.6, 1.4), cloth);
  p.position.set(0.42, h - 0.9, 0.0); p.rotation.y = 0.15;
  g.add(p);
  place(ctx, g, x, z, -ctx.yaw);
  return new THREE.Vector3(x, groundY(x, z) + h - 0.1, z);
}

// pennant bunting along a sagging line
function bunting(ctx, a, b, sag, colors) {
  const n = Math.max(3, Math.round(a.distanceTo(b) / 0.42));
  const geo = new THREE.BufferGeometry();
  const pos = [], col = [];
  const cs = colors.map(c => new THREE.Color(c));
  const pt = (t) => { const p = new THREE.Vector3().lerpVectors(a, b, t); p.y -= sag * 4 * t * (1 - t); return p; };
  for (let i = 0; i < n; i++) {
    const p0 = pt(i / n), p1 = pt((i + 0.75) / n), mid = pt((i + 0.375) / n);
    const tip = mid.clone(); tip.y -= 0.26;
    pos.push(p0.x, p0.y, p0.z, tip.x, tip.y, tip.z, p1.x, p1.y, p1.z);
    const c = cs[i % cs.length]; for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }));
  o.castShadow = true; ctx.scene.add(o);
  const pts = []; for (let i = 0; i <= 16; i++) pts.push(pt(i / 16));
  ctx.scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.01, 3, false), new THREE.MeshStandardMaterial({ color: 0x2a2018 })));
}

function laundry(ctx, a, b) {
  const colors = ['#b0a690', '#8a3a3a', '#a89a80', '#4a6a98', '#b89850', '#a8a08c'];
  const pts = []; const sag = 0.25;
  for (let i = 0; i <= 12; i++) { const t = i / 12; const p = new THREE.Vector3().lerpVectors(a, b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
  const curve = new THREE.CatmullRomCurve3(pts);
  ctx.scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.012, 3, false), new THREE.MeshStandardMaterial({ color: 0x3a3028 })));
  const R = rng(9);
  for (let i = 0; i < 5; i++) {
    const t = 0.15 + i * 0.16, p = curve.getPoint(t);
    const w = 0.35 + R() * 0.25, h = 0.45 + R() * 0.35;
    const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 1 });
    const c = m(new THREE.PlaneGeometry(w, h), mat);
    c.position.set(p.x, p.y - h / 2, p.z);
    c.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    ctx.scene.add(c);
  }
}

// String lights: catenary from a to b with bulbs of varied size / brightness.
function festoon(a, b, sag, ctx, wireMat, bulbs) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  ctx.scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.01, 3, false), wireMat));
  const len = curve.getLength(), n = Math.max(3, Math.round(len / 0.55));
  const R = rng(Math.floor(a.x * 100 + b.z * 37 + 999));
  for (let i = 1; i < n; i++) {
    const p = curve.getPoint((i + (R() - 0.5) * 0.3) / n);
    p.y -= 0.07;
    bulbs.push({ p, s: 0.6 + R() * 0.7, k: 0.45 + R() * 0.75 });
  }
}

export function buildPlaza(ctx) {
  const MM = mats();
  const L = GREAT_LANTERN_LIGHT;

  // --- market ---
  const st1 = stall(ctx, -4.5, -6.7, 0.14, ['#b8433a', '#e8dcc0'], 'flat', ['apple', 'cabbage', 'pumpkin']);
  const st2 = stall(ctx, 3.3, -7.4, -0.08, ['#3d6a9a', '#e8dcc0'], 'gable', ['pumpkin', 'apple']);
  cart(ctx, 6.3, 0.9, -0.55, 'pumpkin');
  cart(ctx, 10.6, -1.6, 2.6, 'sacks');
  cart(ctx, -8.6, -4.0, 1.9, 'cabbage');
  bench(ctx, -6.4, -2.9, Math.PI / 2 - 0.08);
  bench(ctx, 4.9, -1.3, -Math.PI / 2 + 0.2);
  {
    const R = rng(55); const g = new THREE.Group(); ctx.scene.add(g);
    for (const [x, z] of [[-1.0, -7.6], [11.0, -5.1], [-7.2, -6.6], [-4.5, -1.5]]) sack(g, x, groundY(x, z), z, R);
  }

  // --- low stone planter boxes breaking up the open cobbles ---
  {
    const geos = [];
    const boxes = [[-3.6, -3.9, 1.6, 0.7, 0.3], [3.9, -4.2, 1.3, 0.7, -0.2], [-4.4, 4.0, 1.4, 0.6, 0.1]];
    for (const [x, z, w, d, r] of boxes) {
      const g = new THREE.BoxGeometry(w, 0.42, d, 1, 2, 1); g.rotateY(r); g.translate(x, 0.21, z);
      worldUV(g, 1.2); heightAO(g, 0, 0.42, 0.5); geos.push(g);
      const c = new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.1); c.rotateY(r); c.translate(x, 0.44, z);
      worldUV(c, 1.2); heightAO(c, -10, -9, 1.1); geos.push(c);
      for (const k of [-0.3, 0.3]) {
        const s = makeSprite(pxName(k < 0 ? 'flowers' : 'bush', k < 0 ? 0.5 : 0.6), { h: k < 0 ? 0.5 : 0.6, yaw: ctx.yaw, castShadow: true, selfLight: 0.05, flip: k > 0 });
        s.position.set(x + Math.cos(r) * k * w, 0.44, z - Math.sin(r) * k * w); ctx.scene.add(s);
      }
    }
    ctx.scene.add(m(mergeGeos(geos, true), MM.stone));
  }

  // planters around the dais
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2;
    if (Math.sin(a) > 0.7) continue; // keep the front open
    const x = L.x + Math.cos(a) * 2.95, z = L.z + Math.sin(a) * 2.95;
    const s = makeSprite(pxName('flowers', 0.48), { h: 0.48, yaw: ctx.yaw, castShadow: false, selfLight: 0.05 });
    s.position.set(x, 0.2, z);
    ctx.scene.add(s);
  }

  // --- banners at the top of the north stairs + bunting across ---
  const bA = banner(ctx, -3.3, -11.6, '#8a2f2a', '#e0c070', 3.8);
  const bB = banner(ctx, 0.3, -11.6, '#2f4f7a', '#e0c070', 3.8);
  bunting(ctx, bA, bB, 0.35, ['#c84a3a', '#e8d070', '#4a7ab0', '#e8e0d0']);
  const bC = banner(ctx, 12.6, 0.2, '#6a3a6a', '#e0c070', 3.4);

  // --- laundry on the west terrace ---
  {
    const MMd = MM.dark; const g = new THREE.Group();
    const p0 = [-12.6, -6.2], p1 = [-9.0, -6.9];
    for (const [x, z] of [p0, p1]) { const pg = bx(0.1, 2.2, 0.1, x, groundY(x, z) + 1.1, z, MMd, 0.6); g.add(pg); }
    ctx.scene.add(g);
    laundry(ctx, new THREE.Vector3(p0[0], groundY(...p0) + 2.1, p0[1]), new THREE.Vector3(p1[0], groundY(...p1) + 2.1, p1[1]));
  }

  // --- foreground: the plaza's front ledge, dressed and lit (it is the out-of-focus band of the hero shot) ---
  // post-and-rail fence sitting on the wall coping, flower troughs, pots, crates, hay and firewood behind it,
  // and iron wall lanterns on the retaining wall below so the blurred foreground still has lit shapes.
  fence3D(ctx, [[-16, 4.74], [-10.6, 4.74]], 0.9);
  fence3D(ctx, [[-8.6, 4.74], [1.2, 4.74]], 0.9);
  fence3D(ctx, [[3.8, 4.74], [5.76, 4.74], [5.76, 2.74], [12.5, 2.74]], 0.9);
  const PINK = 0xffb8d0, GOLD = 0xfff0a8, LILAC = 0xd8c8ff, WHITE = 0xffffff, RED = 0xffa8a0;
  {
    const R = rng(12);
    hayBale(ctx, -12.9, 4.05, 0.15);
    crateStack(ctx, -14.0, 4.2, 2, R);
    pot(ctx, -11.1, 4.4, 1.1, 'bush', null, true);
    flowerBox(ctx, -7.9, 4.38, 1.3, 0.03, [PINK, WHITE, GOLD]);
    pot(ctx, -5.75, 4.42, 1.0, 'flowers', LILAC);
    basket(ctx, -2.7, 4.3, 'apple', R);
    flowerBox(ctx, -0.6, 4.42, 1.6, -0.02, [GOLD, RED, WHITE, PINK]);
    pot(ctx, 1.05, 4.45, 1.0, 'flowers', PINK, true);
    pot(ctx, 4.0, 4.45, 1.1, 'bush');
    pot(ctx, -3.9, 4.55, 1.0, 'flowers', GOLD, true);
    pot(ctx, 0.2, 3.95, 0.8, 'flowers', LILAC);
    flowerBox(ctx, -12.3, 4.5, 1.1, 0.0, [GOLD, PINK]);
    logPile(ctx, 5.05, 4.0, 0.0, 3, 0.85);
    basket(ctx, 7.0, 2.25, 'cabbage', R);
    flowerBox(ctx, 9.6, 2.42, 1.3, 0.0, [LILAC, PINK, GOLD]);
    crateStack(ctx, 11.4, 2.2, 3, R);
    pot(ctx, 8.2, 2.42, 0.9, 'flowers', GOLD);
    // a few tall shrubs on the lower tier peeking over the wall
    for (const [x, z, hb] of [[-12.4, 5.6, 1.5], [-5.0, 5.55, 1.3], [7.4, 3.6, 1.4], [12.4, 3.7, 1.6], [-15.2, 5.7, 1.7]]) {
      const s = makeSprite(pxName('bush', hb), { h: hb, yaw: ctx.yaw, flip: R() < 0.5, selfLight: 0.05 });
      s.position.set(x, groundY(x, z), z); ctx.scene.add(s);
    }
  }
  sconce(ctx, -7.2, -0.62, 5.03, 0, 1);
  sconce(ctx, -2.4, -0.62, 5.03, 0, 1);
  sconce(ctx, 4.85, -0.62, 5.03, 0, 1);
  sconce(ctx, 9.0, -0.62, 3.03, 0, 1);
  // --- denser clutter round the plaza perimeter, the stalls and the house fronts ---
  {
    const R = rng(77);
    basket(ctx, -6.2, -5.75, 'apple', R);
    basket(ctx, -0.9, -6.9, 'pumpkin', R);
    pot(ctx, 0.4, -7.95, 1.0, 'bush');
    basket(ctx, 5.05, -6.55, 'apple', R);
    basket(ctx, 1.6, -6.45, 'cabbage', R);
    pot(ctx, 8.45, -5.35, 1.0, 'flowers', PINK);
    pot(ctx, 10.6, -5.4, 1.1, 'bush', null, true);
    logPile(ctx, 6.0, -5.75, Math.PI / 2 - 0.05, 3, 0.8);
    pot(ctx, -6.45, 1.55, 1.0, 'bush');
    pot(ctx, -4.15, 2.75, 0.85, 'flowers', GOLD);
    hayBale(ctx, 11.2, 1.5, 0.35);
    basket(ctx, 9.7, 0.95, 'pumpkin', R);
    pot(ctx, 4.3, -2.35, 0.9, 'flowers', LILAC);
    crateStack(ctx, -7.4, -5.1, 2, R);
    {
      // the baker's trestle table of loaves in front of the bakery
      const t = new THREE.Group();
      t.add(bx(1.5, 0.06, 0.7, 0, 0.78, 0, MM.wood, 1));
      for (const [sx, sz] of [[-0.65, -0.28], [0.65, -0.28], [-0.65, 0.28], [0.65, 0.28]]) t.add(bx(0.07, 0.78, 0.07, sx, 0.39, sz, MM.dark, 0.5));
      const ct = stripeTex('#e8dcc0', '#b8a888', false); ct.repeat.set(4, 1);
      const cloth = new THREE.MeshStandardMaterial({ map: ct, roughness: 1, side: THREE.DoubleSide });
      const cl = m(new THREE.PlaneGeometry(1.56, 0.3), cloth); cl.position.set(0, 0.66, 0.36); t.add(cl);
      place(ctx, t, 10.4, -3.4, -0.12);
      produce(t, -0.35, 0.81, 0.0, 'bread', R, 5);
      produce(t, 0.35, 0.81, 0.05, 'bread', R, 4);
      ctx.scene.add(blobShadow(10.4, groundY(10.4, -3.4), -3.35, 0.95, 0.5, 0.55));
      basket(ctx, 11.35, -3.0, 'bread', R);
    }
    // back terrace
    logPile(ctx, -7.6, -13.7, 0.1, 3, 0.9);
    hayBale(ctx, 9.1, -13.7, -0.2);
    crateStack(ctx, 5.3, -13.3, 2, R);
    pot(ctx, 4.6, -13.15, 0.9, 'flowers', PINK);
    pot(ctx, -2.7, -13.2, 1.0, 'bush');
    basket(ctx, 1.0, -12.4, 'cabbage', R);
    // west terrace
    hayBale(ctx, -12.4, -4.3, 0.5);
    pot(ctx, -9.0, -0.6, 1.0, 'flowers', PINK);
    logPile(ctx, -15.2, 1.2, 0.0, 3, 0.9);
    basket(ctx, -11.8, 1.15, 'cabbage', R);
    pot(ctx, -13.0, 1.5, 1.0, 'flowers', PINK);
  }

  // --- festoon lights (short sagging runs behind / beside the lantern) ---
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 });
  const crown = new THREE.Vector3(L.x, L.y + 0.85, L.z);
  const toW = (g, x, y, z) => { const p = new THREE.Vector3(x, y, z); g.localToWorld(p); return p; };
  const bakeryEave = new THREE.Vector3(5.5, 4.35, -5.75);
  const westEave = new THREE.Vector3(-8.7, 1 + 4.3, -8.0);
  const runs = [
    [crown, toW(st1, 1.35, 2.4, -0.65), 0.55],
    [crown, toW(st2, -1.15, 2.1, 0.65), 0.5],
    [toW(st1, -1.35, 2.4, -0.65), westEave, 0.6],
    [toW(st2, 1.15, 2.1, 0.65), bakeryEave, 0.45],
    [crown, new THREE.Vector3(-5.3, 2.35, -5.2), 0.5],
    [crown, new THREE.Vector3(5.6, 2.35, -3.6), 0.5],
    // foreground runs from the front lamps out to the ledge corner posts
    [new THREE.Vector3(-6.6, 2.4, 3.9), new THREE.Vector3(-10.6, 1 + 2.4, 1.6), 0.4],
    [new THREE.Vector3(3.7, 2.4, 3.3), new THREE.Vector3(12.3, 2.4, -0.5), 0.55],
  ];
  const bulbs = [];
  for (const [a, b, s] of runs) festoon(a, b, s, ctx, wireMat, bulbs);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 2.9, 1.2), fog: false });
  const ig = new THREE.SphereGeometry(0.055, 6, 4);
  const im = new THREE.InstancedMesh(ig, bulbMat, bulbs.length);
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  bulbs.forEach((b, i) => {
    d.position.copy(b.p); d.scale.setScalar(b.s); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    im.setColorAt(i, c.setRGB(b.k, b.k * (0.9 + 0.1 * b.s), b.k * (0.8 + 0.2 * b.s)));
  });
  ctx.scene.add(im);
  ctx.bulbs = bulbs.map(b => b.p);
}
