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
    if (x > 19.1 && z < -2.1) out = true;                  // the blind strip behind the east house
    if (x > 20.6) out = !(z > GATE.z0 && z < GATE.z1);    // only the road leaves east
    if (out) g.a[j * g.nx + i] = 1;
  }
  for (const h of HOUSES) if (h.level <= 1) markBox(g, h.x, h.z, h.w / 2 + 0.05, h.d / 2 + 0.05, h.rot);
  for (const p of PROPS) {
    if (p.type === 'great_lantern') {
      // the octagonal dais and the flower planters on its rim, as one smooth circle (no notches
      // between planters to get wedged in; you glide round it)
      markCircle(g, p.x, p.z, 3.05);
      continue;
    }
    if (PROP_R[p.type]) markCircle(g, p.x, p.z, PROP_R[p.type]);
  }
  for (const [x0, z0, x1, z1] of FENCES) markSeg(g, x0, z0, x1, z1, 0.12);
  // the bakery frontage (baker, bread table, pots, barrels by the top of the east stairs) as one smooth
  // solid block: walking east along it glides you down onto the stairs, no blind pockets to get stuck in
  markBox(g, 10.0, -4.95, 3.0, 0.72, 0);
  // the blind pocket between the south-east lamp and Madame Zuzu's stall (you could wedge in there)
  markBox(g, 4.85, 3.35, 0.5, 0.42, 0);
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
    // elliptical footprint: no box corners to snag on, actors slide round each other
    const rx = d.rx || 0.4, rz = d.rz || 0.3;
    const ex = (d.x - x) / rx, ez = (d.z - z) / rz;
    if (ex * ex + ez * ez < 1) {
      // already overlapping (spawned / scripted into it): let the actor walk out
      if (fx !== undefined) { const fx2 = (d.x - fx) / rx, fz2 = (d.z - fz) / rz; if (fx2 * fx2 + fz2 * fz2 < 1 && fx2 * fx2 + fz2 * fz2 <= ex * ex + ez * ez) continue; }
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
// Movement with generous corner / curve sliding: when the straight step is blocked, the actor glides
// sideways round the obstacle (up to ~60 deg off its heading) instead of stopping dead, keeping the
// side it chose so it doesn't jitter. Holding one direction carries you round the dais, carts, NPCs.
export function moveActor(area, a, dx, dz) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  if (canStep(area, a.x, a.z, a.x + dx, a.z + dz, a)) { a.x += dx; a.z += dz; a.slideSide = 0; return true; }
  // axis-separated first (sliding along walls)
  if (dx && dz) {
    if (canStep(area, a.x, a.z, a.x + dx, a.z, a)) { a.x += dx; return true; }
    if (canStep(area, a.x, a.z, a.x, a.z + dz, a)) { a.z += dz; return true; }
  }
  const ux = dx / len, uz = dz / len;
  const sides = a.slideSide ? [a.slideSide, -a.slideSide] : [1, -1];
  for (const ang of [0.5, 0.85, 1.2, 1.45, 1.5708]) {
    let best = null;
    for (const sd of sides) {
      const c = Math.cos(ang * sd), sn = Math.sin(ang * sd);
      const rx = (ux * c - uz * sn) * len * 0.85, rz = (ux * sn + uz * c) * len * 0.85;
      if (!canStep(area, a.x, a.z, a.x + rx, a.z + rz, a)) continue;
      // prefer the side that opens up: from there, does the way ahead (0.6 m) clear soonest?
      let score = 0;
      for (let k = 1; k <= 8; k++) { const qx = a.x + rx * k * 2.5, qz = a.z + rz * k * 2.5; if (!canStep(area, a.x + rx * (k - 1) * 2.5, a.z + rz * (k - 1) * 2.5, qx, qz, a)) { score += 9; break; } if (!canStep(area, qx, qz, qx + ux * 0.5, qz + uz * 0.5, a)) score++; else break; }
      if (sd === a.slideSide) score -= 0.5;            // hysteresis: keep a slide going
      if (!best || score < best.score) best = { rx, rz, sd, score };
    }
    if (best) { a.x += best.rx; a.z += best.rz; a.slideSide = best.sd; return true; }
  }
  // tight curve: a shorter tangent step still gets round it
  for (const sd of sides) for (const ang of [1.2, 1.45]) {
    const c = Math.cos(ang * sd), sn = Math.sin(ang * sd);
    const rx = (ux * c - uz * sn) * len * 0.4, rz = (ux * sn + uz * c) * len * 0.4;
    if (canStep(area, a.x, a.z, a.x + rx, a.z + rz, a)) { a.x += rx; a.z += rz; a.slideSide = sd; return true; }
  }
  a.slideSide = 0;
  return false;
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
// Field: an Octopath-style long-lens tilt. The camera sits ~17 m out, looking down ~21 deg and
// turned 8 deg off-axis so facades recede at an angle; Pip stands a little below centre so the
// plaza floor recedes behind him and rooftops / terraces stack up to the top of the frame.
// `ahead` pulls the look-at point up-screen of Pip (m along -z). Dev overrides: ?fdist= ?fpitch= ?fyaw= ?ffov=
const QS = new URLSearchParams(location.search);
const qn = (k, d) => QS.has(k) ? parseFloat(QS.get(k)) : d;
export const CAMS = {
  // a low, long tilt: the plaza recedes behind Pip, the village climbs to a strip of skyline at the top
  field: { dist: qn('fdist', 21.5), pitch: qn('fpitch', 10.5), yaw: qn('fyaw', 7), fov: qn('ffov', 30), lift: qn('flift', 2.7), ahead: 0.4, range: 2.6, aperture: 22 },
  forest: { dist: qn('fdist', 20), pitch: qn('fpitch', 11), yaw: qn('fyaw', 5), fov: qn('ffov', 30), lift: qn('flift', 2.5), ahead: 0.3, range: 2.6, aperture: 24 },
  // battle: framed from as far out as the field camera, so sprites keep the world's pixel scale; the
  // stage is a diorama (monsters left, party right) with the forest rising behind
  battle: { dist: qn('bdist', 18.5), pitch: qn('bpitch', 16), yaw: qn('byaw', -4), fov: 30, lift: qn('blift', 1.0), range: 3.2, aperture: 30 },
};
export const camState = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, dist: 21, pitch: 9, yaw: 0, wantYaw: 0, fov: 30, focus: 21, range: 2.6, aperture: 20, lock: false, shake: 0 };
export function clampCam(area, x, z) {
  if (area === 'forest') return [Math.max(FOREST.x0 + 3, Math.min(FOREST.x0 + 41, x)), Math.max(-6, Math.min(1.5, z))];
  return [Math.max(-9.5, Math.min(19.5, x)), Math.max(-11.5, Math.min(3.0, z))];
}
const _v = new THREE.Vector3();
export function placeCamera(camera, cs, dt, snap = false) {
  const k = snap ? 1 : 1 - Math.pow(0.02, dt);
  cs.x += (cs.tx - cs.x) * k; cs.y += (cs.ty - cs.y) * k; cs.z += (cs.tz - cs.z) * k;
  const kk = snap ? 1 : 1 - Math.pow(0.05, dt);
  cs.dist += (cs.wantDist - cs.dist) * kk; cs.pitch += (cs.wantPitch - cs.pitch) * kk;
  if (cs.wantYaw !== undefined) cs.yaw = (cs.yaw ?? cs.wantYaw) + (cs.wantYaw - (cs.yaw ?? cs.wantYaw)) * kk;
  const p = cs.pitch * Math.PI / 180, yw = (cs.yaw || 0) * Math.PI / 180;
  const sx = cs.shake ? (Math.random() - 0.5) * cs.shake * 0.05 : 0, sy = cs.shake ? (Math.random() - 0.5) * cs.shake * 0.05 : 0;
  camera.position.set(cs.x + sx + Math.sin(yw) * Math.cos(p) * cs.dist, cs.y + Math.sin(p) * cs.dist + sy, cs.z + Math.cos(yw) * Math.cos(p) * cs.dist);
  _v.set(cs.x + sx, cs.y + sy, cs.z);
  camera.lookAt(_v);
  cs.fovNow = cs.fovNow === undefined ? cs.fov : cs.fovNow + (cs.fov - cs.fovNow) * kk;
  // very wide screens (phones in landscape) keep a 1.9:1 horizontal field instead of seeing ever
  // more to the sides, so the cast stays as large as the screen height allows
  const asp = camera.aspect, fov = asp > 1.9 ? 2 * Math.atan(Math.tan(cs.fovNow * Math.PI / 360) * 1.9 / asp) * 180 / Math.PI : cs.fovNow;
  if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

// ---------- route finding for the goal marker ----------
// A breadth-first distance field over the walk grid toward a goal (respecting walls, props and the
// terrace steps, ie the same rules as moveActor minus the NPCs), and a walker that follows it from
// any spot: the goal arrow points along the real route, never straight through a wall.
let townH = null;
function townHeights() {
  if (townH) return townH;
  const g = townGrid;
  townH = new Float32Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) townH[j * g.nx + i] = groundY(g.x0 + (i + 0.5) * CELL, g.z0 + (j + 0.5) * CELL);
  return townH;
}
export function routeField(gx, gz) {
  const g = townGrid, H = townHeights(), n = g.nx * g.nz;
  const dist = new Int32Array(n).fill(-1), q = new Int32Array(n);
  const free = (k) => !g.a[k] && !(!GATE.open && Math.abs(g.x0 + (k % g.nx + 0.5) * CELL - GATE.x) < 0.5 && (g.z0 + (Math.floor(k / g.nx) + 0.5) * CELL) > GATE.z0 - 0.3 && (g.z0 + (Math.floor(k / g.nx) + 0.5) * CELL) < GATE.z1 + 0.3);
  // seed: every free cell within 0.9 m of the goal (the goal itself may stand on a blocked cell)
  let qh = 0, qt = 0;
  const gi = Math.floor((gx - g.x0) / CELL), gj = Math.floor((gz - g.z0) / CELL);
  for (let r = 6; r <= 16 && qt === 0; r += 5) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = gi + di, j = gj + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || di * di + dj * dj > r * r) continue;
      const k = j * g.nx + i;
      if (free(k) && dist[k] < 0) { dist[k] = 0; q[qt++] = k; }
    }
  }
  while (qh < qt) {
    const k = q[qh++], i = k % g.nx, j = (k - i) / g.nx;
    for (let d = 0; d < 4; d++) {
      const ii = i + (d === 0 ? 1 : d === 1 ? -1 : 0), jj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
      const kk = jj * g.nx + ii;
      if (dist[kk] >= 0 || !free(kk) || Math.abs(H[kk] - H[k]) > 0.3) continue;
      dist[kk] = dist[k] + 1; q[qt++] = kk;
    }
  }
  return { dist, gx, gz };
}
// a point `ahead` metres along the route from (x, z) (or the goal, if nearer); null when unreachable
export function routeAhead(f, x, z, ahead) {
  const g = townGrid;
  let i = Math.floor((x - g.x0) / CELL), j = Math.floor((z - g.z0) / CELL);
  const at = (i, j) => (i < 0 || j < 0 || i >= g.nx || j >= g.nz) ? -1 : f.dist[j * g.nx + i];
  if (at(i, j) < 0) {
    // standing on a blocked cell (pushed against a prop): start from the nearest reachable one
    let best = null;
    for (let r = 1; r <= 5 && !best; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (at(i + di, j + dj) >= 0 && (!best || at(i + di, j + dj) < at(best[0], best[1]))) best = [i + di, j + dj];
    if (!best) return null;
    [i, j] = best;
  }
  const steps = Math.round(ahead / CELL);
  for (let s = 0; s < steps; s++) {
    const c = at(i, j);
    if (c <= 0) return [f.gx, f.gz];
    let bi = i, bj = j, bc = c;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const v = at(i + di, j + dj); if (v >= 0 && v < bc) { bc = v; bi = i + di; bj = j + dj; } }
    if (bi === i && bj === j) break;
    i = bi; j = bj;
  }
  return [g.x0 + (i + 0.5) * CELL, g.z0 + (j + 0.5) * CELL];
}
