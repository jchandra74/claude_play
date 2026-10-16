// World layout: terrain tiers, ground materials, and placement of every object.
// Units are metres. +z points toward the hero camera, the plaza centre is near (0, 0, -1).

export const TIER = 1.0;            // height of one terrain tier (m)
export const GRID = { x0: -46, x1: 46, z0: -52, z1: 24 }; // cell range

// ---------- deterministic noise helpers ----------
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise1(t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}
const wob = (t, amp, seed) => Math.round((noise1(t + seed * 17.3) - 0.5) * 2 * amp);
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- houses ----------
// x,z = footprint centre; w along local x, d along local z; rot = yaw (front faces local +z).
// style: 'timber' (half-timbered plaster), 'stone' (stone ground floor, timber upper), 'planks' (dark board walls)
// lean: optional lean-to shed on local side -1 / +1.
export const HOUSES = [
  { id: 'bakery', x: 8.6, z: -8.2, w: 6.4, d: 4.6, level: 0, rot: -0.05, floors: 2, gableFront: false, roof: 0xc4764e, style: 'timber',
    door: 'door_oak', doorX: 0.9, windows: [{ t: 'window_awning', x: -1.6 }], upper: [{ t: 'window_lattice', x: -1.7 }, { t: 'window_lattice', x: 1.5 }],
    side: ['window_shutter'], sign: true, chimney: [1.8, -0.6], light: true },
  { id: 'west', x: -11.2, z: -10.6, w: 5.2, d: 4.4, level: 1, rot: 0.12, floors: 2, gableFront: true, roof: 0x8f7a6c, style: 'stone',
    door: 'door_pink', doorX: -1.0, windows: [{ t: 'window_shutter', x: 1.15 }], upper: [{ t: 'window_lattice', x: 0 }],
    side: ['window_lattice'], chimney: [-1.2, -0.8], light: true },
  { id: 'westside', x: -13.4, z: -1.6, w: 4.6, d: 4.0, level: 1, rot: Math.PI / 2 + 0.06, floors: 1, gableFront: true, roof: 0xb27a58, style: 'planks',
    door: 'door_oak', doorX: -0.9, windows: [{ t: 'window_lattice', x: 1.1 }], upper: [],
    side: ['window_shutter'], chimney: [1.1, -0.6], light: true, lean: 1 },
  { id: 'eastside', x: 17.0, z: -4.6, w: 5.0, d: 4.4, level: 1, rot: -Math.PI / 2 + 0.1, floors: 2, gableFront: true, roof: 0x9b8f86, style: 'stone',
    door: 'door_pink', doorX: 0.9, windows: [{ t: 'window_shutter', x: -1.2 }], upper: [{ t: 'window_lattice', x: 0 }],
    side: ['window_lattice', 'window_shutter'], chimney: null, light: true },
  { id: 'north_l', x: -4.6, z: -15.4, w: 5.0, d: 4.2, level: 1, rot: 0.05, floors: 2, gableFront: true, roof: 0xa78468, style: 'timber',
    door: 'door_oak', doorX: 1.1, windows: [{ t: 'window_shutter', x: -1.1 }], upper: [{ t: 'window_lattice', x: 0 }],
    side: ['window_lattice'], chimney: [-1.4, 0.5], light: true },
  { id: 'north_r', x: 6.8, z: -15.6, w: 6.2, d: 4.2, level: 1, rot: -0.08, floors: 1, gableFront: false, roof: 0xbf8660, style: 'planks',
    door: 'door_pink', doorX: -1.4, windows: [{ t: 'window_shutter', x: 1.3 }], upper: [],
    side: ['window_shutter'], chimney: [1.6, -0.4], light: true, lean: -1 },
  { id: 'far_l', x: -14.0, z: -23.6, w: 5.6, d: 4.4, level: 2, rot: 0.18, floors: 2, gableFront: true, roof: 0x9d8070, style: 'stone',
    door: 'door_oak', doorX: 0, windows: [{ t: 'window_lattice', x: -1.6 }, { t: 'window_lattice', x: 1.6 }], upper: [{ t: 'window_lattice', x: 0 }],
    side: [], chimney: null, light: false },
  { id: 'far_c', x: 2.0, z: -25.2, w: 7.0, d: 4.8, level: 2, rot: -0.04, floors: 2, gableFront: false, roof: 0xb07c5c, style: 'timber',
    door: 'door_pink', doorX: -2.0, windows: [{ t: 'window_shutter', x: 0.4 }, { t: 'window_shutter', x: 2.4 }], upper: [{ t: 'window_lattice', x: -1.8 }, { t: 'window_lattice', x: 1.8 }],
    side: [], chimney: [2.2, 0.6], light: true },
  { id: 'far_r', x: 15.5, z: -23.0, w: 5.4, d: 4.4, level: 2, rot: -0.22, floors: 1, gableFront: true, roof: 0xa58a72, style: 'planks',
    door: 'door_oak', doorX: 0.8, windows: [{ t: 'window_lattice', x: -1.2 }], upper: [{ t: 'window_lattice', x: 0 }],
    side: [], chimney: null, light: false },
];

// ---------- terrain tiers ----------
// Village tiers have straight, mason-built retaining walls; the outer tiers are natural rock.
function rawLevel(x, z) {
  let L = 0;
  // back terrace (level 1), stepping forward on the left
  const e1 = x < -4 ? -8 : (x < 5 ? -11 : -12);
  // second terrace (level 2)
  const e2 = x < -7 ? -18 : (x < 7 ? -20 : -19);
  const e3 = -29 + wob(x * 0.17, 1.6, 3);
  const e4 = -37 + wob(x * 0.15, 2.0, 4);
  if (z < e1) L = 1;
  if (z < e2) L = 2;
  if (z < e3) L = 3;
  if (z < e4) L = 4;
  // raised west terrace, joined to the back terrace
  if (x < -8 && z < 3 && z >= e1) L = 1;
  if (x < -16 && z < -3) L = Math.max(L, 2);
  // raised east terrace beyond the bakery
  if (x >= 13 && z < 1 && z >= e1) L = 1;
  // lower tiers toward the camera
  const f1 = x < -3 ? 5 : (x < 4 ? 5 : 4);
  if (z >= f1) L = -1;
  if (x >= 6 && z >= 3 && x < 21) L = Math.min(L, -1);
  if (z >= 9 + (x < 0 ? 1 : 0)) L = -2;
  // far sides climb into the forest
  const ax = Math.abs(x) + (x < 0 ? 0.5 : 0);
  const sx1 = 22 + wob(z * 0.25, 1.4, 7);
  const sx2 = 30 + wob(z * 0.2, 2, 8);
  if (ax > sx1) L = Math.max(L + 1, 1);
  if (ax > sx2) L = Math.max(L + 1, 2);
  return L;
}

export function houseLocal(h, x, z) {
  const dx = x - h.x, dz = z - h.z;
  const c = Math.cos(-h.rot), s = Math.sin(-h.rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function levelAt(x, z) {
  for (const h of HOUSES) {
    const [lx, lz] = houseLocal(h, x, z);
    if (Math.abs(lx) < h.w / 2 + 0.8 && Math.abs(lz) < h.d / 2 + 0.9) return h.level;
  }
  return rawLevel(x, z);
}

// Edge style for a cliff face at (x,z): 'wall' = dressed stone retaining wall, 'rock' = natural cliff.
export function wallStyle(x, z) {
  return (Math.abs(x) < 21 && z > -22 && z < 13) ? 'wall' : 'rock';
}

// Stairs. axis 'z' (default): x = centre, edge = z of the tier edge, steps descend toward +z.
// axis 'x': z = centre, edge = x of the tier edge, steps descend toward +x.
// low = level at the foot. n steps over one tier.
export const STAIRS = [
  { x: -1.5, edge: -11, w: 2.4, dir: 1, low: 0 },
  { x: 1.5, edge: -20, w: 2.2, dir: 1, low: 1 },
  { axis: 'x', z: -2.0, edge: -8, w: 2.2, dir: 1, low: 0 },
  { x: 2.5, edge: 5, w: 2.2, dir: 1, low: -1 },
  { x: -9.6, edge: 3, w: 1.8, dir: 1, low: 0 },
  { axis: 'x', z: -2.2, edge: 13, w: 1.8, dir: -1, low: 0 },
];

// ---------- ground materials ----------
// < 1 inside the cobbled plaza (an irregular, lopsided shape around the Great Lantern)
export function plazaDist(x, z) {
  const ax = Math.abs((x - 0.6) / (x < 0.6 ? 7.6 : 9.4)), az = Math.abs((z + 3.0) / (z < -3 ? 7.4 : 7.6));
  return Math.pow(Math.pow(ax, 4) + Math.pow(az, 4), 1 / 4);
}

// returns [grass, cobble, dirt] in 0..1
function onStairs(x, z) {
  for (const s of STAIRS) {
    const [a, d] = s.axis === 'x' ? [z - s.z, (x - s.edge) * s.dir] : [x - s.x, (z - s.edge) * s.dir];
    if (Math.abs(a) < s.w / 2 + 0.5 && d > -0.6 && d < 2.2) return true;
  }
  return false;
}

export function groundAt(x, z) {
  if (onStairs(x, z)) return [0, 0.35, 0.65];
  const n = (noise2(x * 0.9, z * 0.9) - 0.5) * 0.35 + (noise2(x * 3.1, z * 3.1) - 0.5) * 0.12;
  const pd = plazaDist(x, z) + n * 0.3;
  const L = rawLevel(x, z);
  if (pd < 1.0 && L === 0) {
    // worn spots where the cobbles have sunk into mud
    const wear = noise2(x * 0.55 + 13, z * 0.55 - 4);
    if (wear > 0.8 && Math.hypot(x, z + 1.2) > 3.4) return [0, 0.45, 0.55];
    return [0, 1, 0];
  }
  let dirt = 0, cob = 0;
  // cobbled lanes up the stairs and along the terraces
  const lane = (Math.abs(x + 1.5 - 0.4 * Math.sin(z * 0.3)) < 1.5 + n && z < -10 && z > -20) ||
    (Math.abs(x - 1.5) < 1.4 + n && z < -19.5 && z > -24) ||
    (Math.abs(z + 2 - 0.5 * Math.sin(x * 0.4)) < 1.3 + n && x < -7 && x > -12) ||
    (Math.abs(z + 2.2) < 1.1 + n && x > 12.5 && x < 15);
  if (lane) cob = 1;
  // dirt paths
  const north = Math.abs(x + 1.5 - 0.8 * Math.sin(z * 0.17)) < 2.2 + n * 1.4 && z < -9;
  const south = Math.abs(x - 2.5 + 0.5 * Math.sin(z * 0.3)) < 1.4 + n * 1.2 && z > 4;
  const west = Math.abs(z + 2 - 0.8 * Math.sin(x * 0.25 + 1)) < 1.6 + n * 1.2 && x < -7;
  const east = Math.abs(z + 2.2 - 0.9 * Math.sin(x * 0.22)) < 1.5 + n * 1.2 && x > 11;
  const terr = Math.abs(z + 13.5 - 0.6 * Math.sin(x * 0.3)) < 1.3 + n * 1.2 && Math.abs(x) < 14;
  if (north || south || west || east || terr) dirt = 1;
  // muddy apron round the plaza
  if (pd < 1.14 && L === 0) dirt = 1;
  // door paths
  for (const h of HOUSES) {
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const fx = h.x + s * (h.d / 2 + 0.9) + c * h.doorX, fz = h.z + c * (h.d / 2 + 0.9) - s * h.doorX;
    if (Math.hypot(x - fx, z - fz) < 1.2 + n * 1.5) dirt = 1;
  }
  // scattered bare patches
  if (noise2(x * 0.35 + 40, z * 0.35) > 0.76) dirt = Math.max(dirt, 0.7);
  if (cob) return [0, 0.8, 0.2];
  return [1 - dirt, 0, dirt];
}

// ---------- ground detail (moss in the grout, worn walking lines, puddles) ----------
// puddles: x, z, rx, rz (m). Rain-filled dips in the cobbles; the shader makes them dark + glossy.
export const PUDDLES = [
  [-0.7, 3.3, 0.62, 0.3], [4.7, 1.5, 0.5, 0.26], [-3.0, -4.75, 0.45, 0.24], [7.6, -1.9, 0.5, 0.26],
  [-6.1, 0.5, 0.42, 0.22], [1.9, -5.0, 0.38, 0.2], [-1.2, -13.6, 0.55, 0.28], [-10.8, -2.2, 0.4, 0.22],
];
// walking lines worn smooth into the cobbles (polyline, half-width)
export const WALKS = [
  [[[-1.5, -10.6], [-2.2, -6.5], [-2.9, -3.2]], 1.0],
  [[[2.5, 4.8], [2.2, 3.0], [1.8, 1.9]], 0.9],
  [[[-7.8, -2.0], [-4.6, -2.3], [-3.2, -2.0]], 0.9],
  [[[12.6, -2.2], [8.0, -2.4], [3.4, -1.6]], 0.9],
  [[[9.5, -5.6], [7.4, -3.6], [4.2, -2.8]], 0.8],
  [[[-11.0, 0.0], [-9.6, 2.2]], 0.7],
];
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
// returns [moss, wear, puddle] in 0..1
export function groundDetail(x, z) {
  const n = noise2(x * 0.8 + 31, z * 0.8 - 7), n2 = noise2(x * 2.3 - 5, z * 2.3 + 11);
  const pd = plazaDist(x, z);
  // moss creeps in from the plaza rim and the shady corners, sparse in the open
  let moss = Math.max(0, Math.min(1, (pd - 0.72) / 0.3)) * (0.55 + 0.6 * n) + (n2 > 0.72 ? 0.35 : 0) + (n > 0.78 ? 0.3 : 0);
  if (Math.hypot(x, z + 1.2) < 4.2) moss *= 0.3;
  let wear = 0;
  for (const [pts, hw] of WALKS) for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    wear = Math.max(wear, 1 - Math.max(0, Math.min(1, (d - hw * 0.4) / hw)));
  }
  const rr = Math.hypot(x, z + 1.2);
  wear = Math.max(wear, 1 - Math.min(1, Math.abs(rr - 4.6) / 1.3));
  moss *= 1 - wear * 0.85;
  let pud = 0;
  for (const [px, pz, rx, rz] of PUDDLES) {
    const q = Math.hypot((x - px) / rx, (z - pz) / rz) + (n2 - 0.5) * 0.45;
    pud = Math.max(pud, 1 - Math.max(0, Math.min(1, (q - 0.55) / 0.6)));
  }
  return [Math.min(1, moss), wear, pud];
}

// ---------- props ----------
// type, x, z, h (height m); optional flip, dy
export const PROPS = [
  // Great Lantern & plaza dressing
  { type: 'great_lantern', x: 0, z: -1.2, h: 5.6 },
  { type: 'well', x: -5.2, z: 2.0, h: 1.75 },
  { type: 'lamp', x: -5.3, z: -5.2, h: 2.7 },
  { type: 'lamp', x: 5.6, z: -3.6, h: 2.7 },
  { type: 'lamp', x: -6.6, z: 3.9, h: 2.7 },
  { type: 'lamp', x: 3.7, z: 3.3, h: 2.7 },
  { type: 'lamp', x: -3.3, z: -12.0, h: 2.7 },
  { type: 'lamp', x: 13.8, z: -7.6, h: 2.7 },
  { type: 'lamp', x: -10.6, z: 1.6, h: 2.7 },
  { type: 'lamp', x: 12.3, z: -0.5, h: 2.7 },
  // market clutter behind the stalls
  { type: 'crate', x: -6.3, z: -7.3, h: 0.72 }, { type: 'crate', x: -6.0, z: -6.7, h: 0.6, flip: true },
  { type: 'barrel', x: -2.4, z: -7.8, h: 0.8 }, { type: 'barrel', x: -1.9, z: -7.3, h: 0.72 },
  { type: 'crate', x: 2.0, z: -8.3, h: 0.72 }, { type: 'barrel', x: 2.7, z: -8.5, h: 0.8 },
  // bakery clutter
  { type: 'barrel', x: 12.2, z: -5.0, h: 0.8 }, { type: 'barrel', x: 12.4, z: -4.3, h: 0.78 },
  { type: 'crate', x: 11.5, z: -4.6, h: 0.72 }, { type: 'crate', x: 5.0, z: -5.3, h: 0.72 },
  { type: 'crate', x: 5.4, z: -5.7, h: 0.55, flip: true },
  // west terrace / stairs
  { type: 'barrel', x: -9.4, z: -5.6, h: 0.8 }, { type: 'crate', x: -10.0, z: -5.1, h: 0.72 },
  { type: 'barrel', x: -8.9, z: 1.9, h: 0.8 }, { type: 'flowers', x: -8.7, z: -0.3, h: 0.5 },
  { type: 'crate', x: -12.2, z: 2.1, h: 0.72 },
  // open-cobble clusters west of the dais and by the east cart
  { type: 'barrel', x: -4.6, z: -0.9, h: 0.8 }, { type: 'crate', x: -4.1, z: -0.4, h: 0.62 },
  { type: 'crate', x: -4.9, z: -0.2, h: 0.72, flip: true },
  { type: 'barrel', x: 7.6, z: 0.2, h: 0.78 }, { type: 'crate', x: 8.1, z: 0.8, h: 0.6 },
  // front edge & lower tier
  { type: 'barrel', x: 7.4, z: 3.9, h: 0.8 }, { type: 'crate', x: 8.0, z: 4.4, h: 0.72 },
  { type: 'barrel', x: 0.5, z: -10.2, h: 0.8 }, { type: 'crate', x: 3.6, z: -13.0, h: 0.72 },
  { type: 'crate', x: -7.0, z: -13.2, h: 0.72 }, { type: 'barrel', x: 9.6, z: -12.7, h: 0.8 },
  // trees near the plaza
  { type: 'oak', x: 10.6, z: 3.6, h: 5.6 },
  { type: 'oak', x: -11.0, z: -4.8, h: 5.4, flip: true },
  { type: 'pine', x: -16.6, z: -8.4, h: 6.0 },
  { type: 'pine', x: 14.6, z: -10.8, h: 6.4 },
  { type: 'oak', x: -0.8, z: -22.4, h: 6.4 },
  { type: 'pine', x: 11.8, z: -16.2, h: 5.6 },
  { type: 'oak', x: -12.0, z: -15.6, h: 6.0, flip: true },
  { type: 'pine', x: 10.6, z: -21.0, h: 6.2 },
  // foreground framing (blurred)
  { type: 'pine', x: -12.5, z: 11.5, h: 8.5 },
  { type: 'oak', x: -7.4, z: 13.0, h: 7.5 },
  { type: 'pine', x: 18.5, z: 13.5, h: 9.0 },
  { type: 'oak', x: 4.0, z: 15.5, h: 6.5, flip: true },
];

// Fences: polyline segments (x0,z0 -> x1,z1) placed on the ground
export const FENCES = [
  [-20.5, 2.45, -11.2, 2.45],
  [-7.6, -8.55, -6.6, -8.55], [-7.4, -11.6, -3.0, -11.6],
  [0.0, -11.6, 4.6, -11.6],
  [-15.5, -20.6, 0.2, -20.6], [3.0, -20.6, 9.0, -20.6],
];

// Characters: Pip & Moss + villagers. h = height (m). frame name = sprite key.
export const PIP_H = 0.95;
export const CHARACTERS = [
  { name: 'pip', sprite: 'pip_down_0', x: 0.55, z: 1.75, h: PIP_H },
  { name: 'moss', sprite: 'moss_right_0', flip: true, x: 1.55, z: 1.55, h: PIP_H * 1.03 },
  { name: 'mayor', sprite: 'mayor', x: -1.9, z: 1.25, h: PIP_H * 1.17 },
  { name: 'baker', sprite: 'baker', x: 7.6, z: -4.6, h: PIP_H * 1.13 },
  { name: 'guard', sprite: 'guard', x: 6.9, z: -3.4, h: PIP_H * 1.22 },
  { name: 'kid', sprite: 'kid', x: -3.7, z: 3.4, h: PIP_H * 1.0 },
  { name: 'zuzu', sprite: 'zuzu', x: -6.2, z: -1.0, h: PIP_H * 1.15 },
  // villager groups dressing the market
  { name: 'sentry', sprite: 'guard', flip: true, x: -3.9, z: -12.4, h: PIP_H * 1.22 },
];

// Lights tied to props, used by lighting + haze. (computed in lighting.js from PROPS)
export const GREAT_LANTERN_LIGHT = { x: 0, y: 4.45, z: -1.2 };
