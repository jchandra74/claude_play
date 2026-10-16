// World services for the playable demo: walk collision (baked grids for the plaza and the forest,
// plus tier heights so walls / cliffs block and stairs climb), actor movement with corner sliding,
// the HD-2D follow camera, area switching (sky + moonlight move with the active area), the key-light
// probe used to shade characters, and the Great Lantern level (stub until lighting.js exports
// setLanternLevel).
import * as THREE from 'three';
import * as LIGHTING from './lighting.js';
import { HOUSES, PROPS, FENCES, houseLocal, GREAT_LANTERN_LIGHT } from './layout.js';
import { groundY } from './terrain.js';
import { COLLIDERS } from './plaza.js';
import { FOREST, FOREST_COLLIDERS, forestGround, MUSHROOMS } from './forest.js';
import { LIGHT } from './game_actors.js';

const FOOT = 0.26;          // actor foot radius (m)
const CELL = 0.1;

function makeGrid(x0, z0, x1, z1) {
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  return { x0, z0, nx, nz, a: new Uint8Array(nx * nz) };
}
function markCircle(g, x, z, r) {
  r += FOOT;
  const i0 = Math.max(0, Math.floor((x - r - g.x0) / CELL)), i1 = Math.min(g.nx - 1, Math.ceil((x + r - g.x0) / CELL));
  const j0 = Math.max(0, Math.floor((z - r - g.z0) / CELL)), j1 = Math.min(g.nz - 1, Math.ceil((z + r - g.z0) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cx = g.x0 + (i + 0.5) * CELL, cz = g.z0 + (j + 0.5) * CELL;
    if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) g.a[j * g.nx + i] = 1;
  }
}
function markBox(g, x, z, hw, hd, rot, v = 1) {
  const R = Math.hypot(hw, hd) + FOOT;
  const c = Math.cos(rot), s = Math.sin(rot);
  const i0 = Math.max(0, Math.floor((x - R - g.x0) / CELL)), i1 = Math.min(g.nx - 1, Math.ceil((x + R - g.x0) / CELL));
  const j0 = Math.max(0, Math.floor((z - R - g.z0) / CELL)), j1 = Math.min(g.nz - 1, Math.ceil((z + R - g.z0) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = g.x0 + (i + 0.5) * CELL - x, dz = g.z0 + (j + 0.5) * CELL - z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < hw + FOOT && Math.abs(lz) < hd + FOOT) g.a[j * g.nx + i] = v;
  }
}
function markSeg(g, x0, z0, x1, z1, r) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 0.1));
  for (let k = 0; k <= n; k++) markCircle(g, x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n, r);
}
function cellAt(g, x, z) {
  const i = Math.floor((x - g.x0) / CELL), j = Math.floor((z - g.z0) / CELL);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return 1;
  return g.a[j * g.nx + i];
}

export const GATE = { x: 20.3, z0: -1.45, z1: 1.15, open: false };
let townGrid = null, forestGrid = null;
const PROP_R = { lamp: 0.2, barrel: 0.3, crate: 0.36, well: 0.85, oak: 0.5, pine: 0.42 };

export function bakeCollision() {
  // ---- town ----
  const g = townGrid = makeGrid(-16, -14, 22.5, 5.2);
  // bounds of the walkable town
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.x0 + (i + 0.5) * CELL, z = g.z0 + (j + 0.5) * CELL;
    let out = x < -15.0 || x > 21.4 || z < -13.05 || z > 4.35;
    if (x < -8.2 && z < -8.0) out = true;                  // behind the west houses
    if (x > 13 && z > 0.95) out = true;                    // east terrace edge
    if (x > 20.6) out = !(z > GATE.z0 && z < GATE.z1);    // only the road leaves east
    if (out) g.a[j * g.nx + i] = 1;
  }
  for (const h of HOUSES) if (h.level <= 1) markBox(g, h.x, h.z, h.w / 2 + 0.05, h.d / 2 + 0.05, h.rot);
  for (const p of PROPS) {
    if (p.type === 'great_lantern') {
      markCircle(g, p.x, p.z, 2.62);                       // the octagonal dais
      for (let i = 0; i < 8; i++) {                         // flower planters on its rim
        const a = (i + 0.5) / 8 * Math.PI * 2;
        if (Math.sin(a) <= 0.7) markCircle(g, p.x + Math.cos(a) * 2.95, p.z + Math.sin(a) * 2.95, 0.2);
      }
      continue;
    }
    if (PROP_R[p.type]) markCircle(g, p.x, p.z, PROP_R[p.type]);
  }
  for (const [x0, z0, x1, z1] of FENCES) markSeg(g, x0, z0, x1, z1, 0.12);
  for (const c of COLLIDERS) {
    if (c.t === 'c') markCircle(g, c.x, c.z, c.r);
    else if (c.t === 'box') markBox(g, c.x, c.z, c.hw, c.hd, c.rot);
    else markSeg(g, c.x0, c.z0, c.x1, c.z1, c.r);
  }
  // ---- forest ----
  const X = FOREST.x0, Z = FOREST.z0;
  const f = forestGrid = makeGrid(X - 6, Z - 9, X + 50, Z + 7);
  for (let j = 0; j < f.nz; j++) for (let i = 0; i < f.nx; i++) {
    const x = f.x0 + (i + 0.5) * CELL, z = f.z0 + (j + 0.5) * CELL;
    const lx = x - X;
    if (lx < -4.2 || lx > FOREST.x1 || Math.abs(forestGround(x, z)) > 0.35) f.a[j * f.nx + i] = 1;
  }
  for (const c of FOREST_COLLIDERS) markCircle(f, c.x, c.z, c.r);
}

// dynamic blockers (NPCs, map monsters), set by the game each frame
export const DYN = [];

export function blocked(area, x, z, self, fx, fz) {
  const g = area === 'forest' ? forestGrid : townGrid;
  if (cellAt(g, x, z)) return true;
  if (area === 'town' && !GATE.open && x > GATE.x - 0.5 && x < GATE.x + 0.4 && z > GATE.z0 - 0.3 && z < GATE.z1 + 0.3) return true;
  for (let i = 0; i < DYN.length; i++) {
    const d = DYN[i];
    if (d === self || !d.solid || !d.visible) continue;
    const rx = d.rx || 0.4, rz = d.rz || 0.3;
    if (Math.abs(d.x - x) < rx && Math.abs(d.z - z) < rz) {
      // already overlapping (spawned / scripted into it): let the actor walk out
      if (fx !== undefined && Math.abs(d.x - fx) < rx && Math.abs(d.z - fz) < rz) continue;
      return true;
    }
  }
  return false;
}
export function groundOf(area) { return area === 'forest' ? forestGround : groundY; }

function canStep(area, x0, z0, x1, z1, self) {
  if (blocked(area, x1, z1, self, x0, z0)) return false;
  if (area === 'town') return Math.abs(groundY(x1, z1) - groundY(x0, z0)) <= 0.3;
  return true;
}
export function moveActor(area, a, dx, dz) {
  let moved = false;
  if (dx) {
    if (canStep(area, a.x, a.z, a.x + dx, a.z, a)) { a.x += dx; moved = true; }
    else for (const s of [1, -1]) if (canStep(area, a.x, a.z, a.x + dx, a.z + s * 0.06, a)) { a.z += s * 0.03; moved = true; break; }
  }
  if (dz) {
    if (canStep(area, a.x, a.z, a.x, a.z + dz, a)) { a.z += dz; moved = true; }
    else for (const s of [1, -1]) if (canStep(area, a.x, a.z, a.x + s * 0.06, a.z + dz, a)) { a.x += s * 0.03; moved = true; break; }
  }
  return moved;
}

// ---------- the Great Lantern level ----------
// lighting.js will export setLanternLevel(ctx, k); until then this stub dims what it can reach:
// the lantern's point light, its pools / haze and (to 30%) the street-lamp pools.
let stubBase = null;
function stubSetLanternLevel(ctx, k) {
  if (!stubBase) {
    stubBase = {
      flick: (ctx.flicker || []).map(f => f.base),
      haze: (ctx.hazeLights || []).map(h => h.strength),
      halos: [], bulbs: null,
    };
    const L = GREAT_LANTERN_LIGHT;
    ctx.scene.traverse(o => {
      if (o.isSprite && Math.hypot(o.position.x - L.x, o.position.y - L.y, o.position.z - L.z) < 0.05) stubBase.halos.push(o);
      if (o.isInstancedMesh && o.material.isMeshBasicMaterial && o.material.color.r > 3) stubBase.bulbs = { m: o.material, c: o.material.color.clone() };
    });
  }
  for (const h of stubBase.halos) h.visible = k > 0.05;
  if (stubBase.bulbs) stubBase.bulbs.m.color.copy(stubBase.bulbs.c).multiplyScalar(0.12 + 0.88 * Math.max(0, Math.min(1, (k - 0.2) / 0.5)));
  (ctx.flicker || []).forEach((f, i) => { f.base = stubBase.flick[i] * k; });
  for (const p of ctx.pools || []) {
    if (p._lkBase === undefined) { if (p.prio !== 0 && p.prio !== 1) continue; p._lkBase = p.intensity; }
    if (p.prio === 0) p.intensity = p._lkBase * Math.min(1, k / 0.45);
    else if (p.prio === 1) {
      const th = 0.3 + 0.5 * Math.min(1, Math.hypot(p.pos.x - GREAT_LANTERN_LIGHT.x, p.pos.z - GREAT_LANTERN_LIGHT.z) / 16);
      p.intensity = p._lkBase * (0.14 + 0.86 * Math.max(0, Math.min(1, (k - th) / 0.08)));
    }
  }
  (ctx.hazeLights || []).forEach((h, i) => { if (i < stubBase.haze.length) h.strength = stubBase.haze[i] * (i === 0 ? k : 0.35 + 0.65 * k); });
}
export const lanternLevelImpl = () => (typeof LIGHTING.setLanternLevel === 'function' ? 'lighting.js' : 'stub');
export function setLanternLevel(ctx, k) {
  if (typeof LIGHTING.setLanternLevel === 'function') LIGHTING.setLanternLevel(ctx, k);
  else stubSetLanternLevel(ctx, k);
}

// ---------- key light probe for character shading ----------
const WARM = new THREE.Color(1.0, 0.6, 0.26), MOONC = new THREE.Color(0.45, 0.62, 1.0);
const probeOut = { x: 0, z: 0, k: 0, color: new THREE.Color() };
export function makeProbe(ctx, G, extra) {
  const L = GREAT_LANTERN_LIGHT;
  return (x, z) => {
    let best = -1, bx = x - 3, bz = z - 3, col = MOONC;
    if (G.area === 'town') {
      const lk = 3.0 * Math.max(0.05, G.lanternK);
      const d = Math.hypot(L.x - x, L.z - z), k = lk / (1 + d * d * 0.12);
      if (k > best) { best = k; bx = L.x; bz = L.z; col = WARM; }
      const lampK = 0.4 + 0.6 * G.lanternK;
      for (const l of ctx.lamps || []) {
        const dd = Math.hypot(l.x - x, l.z - z), kk = lampK / (1 + dd * dd * 0.12);
        if (kk > best) { best = kk; bx = l.x; bz = l.z; col = WARM; }
      }
    } else {
      for (const m of MUSHROOMS) {
        const dd = Math.hypot(m.x - x, m.z - z), kk = 0.8 / (1 + dd * dd * 0.25);
        if (kk > best) { best = kk; bx = m.x; bz = m.z; col = m.col; }
      }
    }
    if (extra) for (const e of extra) {
      if (!e.on) continue;
      const dd = Math.hypot(e.x - x, e.z - z), kk = e.k / (1 + dd * dd * 0.2);
      if (kk > best) { best = kk; bx = e.x; bz = e.z; col = e.color; }
    }
    probeOut.x = bx; probeOut.z = bz; probeOut.color = col;
    probeOut.k = Math.min(1, Math.max(0.3, best));
    return probeOut;
  };
}

// ---------- area switching: sky + moonlight follow the active area ----------
export function areaOrigin(area) { return area === 'forest' ? [FOREST.x0 + 20, FOREST.z0] : [0, 0]; }
export function applyArea(ctx, area) {
  const [ox, oz] = areaOrigin(area);
  if (ctx.skyObjs) for (const o of ctx.skyObjs) o.position.set(ox, 0, oz);
  if (ctx.moon) {
    if (!ctx.moonBase) ctx.moonBase = { p: ctx.moon.position.clone(), t: ctx.moon.target.position.clone() };
    ctx.moon.position.copy(ctx.moonBase.p).add(new THREE.Vector3(ox, 0, oz));
    ctx.moon.target.position.copy(ctx.moonBase.t).add(new THREE.Vector3(ox, 0, oz));
    ctx.moon.target.updateMatrixWorld();
    const d = new THREE.Vector3().copy(ctx.moon.target.position).sub(ctx.moon.position); d.y = 0; d.normalize();
    LIGHT.moonAng = Math.atan2(-d.x, -d.z);
  }
}

// ---------- follow camera ----------
export const CAMS = {
  field: { dist: 23, pitch: 9, fov: 32, lift: 2.2, range: 2.8, aperture: 20 },
  battle: { dist: 14.5, pitch: 10, fov: 32, lift: -0.45, range: 1.9, aperture: 44 },
};
export const camState = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, dist: 21, pitch: 9, fov: 32, focus: 21, range: 2.6, aperture: 20, lock: false, shake: 0 };
export function clampCam(area, x, z) {
  if (area === 'forest') return [Math.max(FOREST.x0 + 3, Math.min(FOREST.x0 + 41, x)), Math.max(-6, Math.min(1.5, z))];
  return [Math.max(-9.5, Math.min(16.5, x)), Math.max(-11.5, Math.min(2.5, z))];
}
const _v = new THREE.Vector3();
export function placeCamera(camera, cs, dt, snap = false) {
  const k = snap ? 1 : 1 - Math.pow(0.02, dt);
  cs.x += (cs.tx - cs.x) * k; cs.y += (cs.ty - cs.y) * k; cs.z += (cs.tz - cs.z) * k;
  const kk = snap ? 1 : 1 - Math.pow(0.05, dt);
  cs.dist += (cs.wantDist - cs.dist) * kk; cs.pitch += (cs.wantPitch - cs.pitch) * kk;
  const p = cs.pitch * Math.PI / 180;
  const sx = cs.shake ? (Math.random() - 0.5) * cs.shake * 0.05 : 0, sy = cs.shake ? (Math.random() - 0.5) * cs.shake * 0.05 : 0;
  camera.position.set(cs.x + sx, cs.y + Math.sin(p) * cs.dist + sy, cs.z + Math.cos(p) * cs.dist);
  _v.set(cs.x + sx, cs.y + sy, cs.z);
  camera.lookAt(_v);
  if (camera.fov !== cs.fov) { camera.fov = cs.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}
