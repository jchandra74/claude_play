// The Whisperwood: the forest east of Wickhollow, built in the same HD-2D style as the plaza.
// It lives in the same scene, offset far to the east (FOREST.x0) so the plaza and the forest share
// one renderer, one lighting system and one post pipeline; the game moves the sky and moonlight
// with the active area.
// Layout (local metres, +z toward the camera): a winding dirt path runs west to east along z ~ 0 on
// the forest floor. Behind it the set falls away in depth layers rather than one wall:
//   near   - the path, its verges and two low mossy terraces (stacked rock blocks with grass caps);
//   mid    - a third terrace and an upper plateau with groves, ending at a crenellated rim;
//   far    - beyond the rim the ground drops to a far forest floor of tall pines, then low hills;
//   gaps   - the groves break open so luminous moonlit mist (layered sheets) shows between them, and
//            behind the clearing the far layers part into an open window of sky.
// Every layer past the path takes an aerial-perspective lift toward moonlit mist (shader haze keyed on
// depth, plus additive mist sheets between the layers), so the depth reads even before the post DOF.
// One texel grid: trees are generated natively at 56 px/m (game_tex.js), like the rocks, bushes,
// ground and grass. Moonbeams taper, vary and land as pale pools; the clearing is its own place: open
// sky above, and Gerald's hoard of stolen lanterns glowing warm round his stump as the focal light.
import * as THREE from 'three';
import { tileTex, makeSprite } from './assets.js';
import { pxName, blobShadow } from './props.js';
import { rng, noise2, hash2 } from './layout.js';
import { quality } from './config.js';
import { frame, treeKey } from './game_tex.js';

export const FOREST = { x0: 600, z0: 0, entryX: -1.5, clearX: 40, clearZ: -1.2, clearR: 6.2, x1: 47 };

// path centre line (local)
export function pathZ(lx) { return 0.7 * Math.sin(lx * 0.16) + 0.35 * Math.sin(lx * 0.41 + 1.3); }

const smooth = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
// blocky, jogging offsets: constant along a segment, with a short sharp step between segments
function jag(lx, seed, amp, seg) {
  const t = lx / seg, i = Math.floor(t), f = t - i;
  const a = (hash2(i, seed) - 0.5) * amp, b = (hash2(i + 1, seed) - 0.5) * amp;
  return a + (b - a) * smooth(0.4, 0.6, f);
}
const clearPush = (lx, amt) => amt * smooth(12, 5, Math.abs(lx - FOREST.clearX));
// the window behind the clearing (1 on its axis, 0 away from it)
const win = (lx) => smooth(9, 4, Math.abs(lx - FOREST.clearX));
// terrace edges (local z) and the height each one climbs
const LEDGES = [
  (lx) => -4.3 + 0.5 * Math.sin(lx * 0.19) + jag(lx, 11, 1.3, 2.7) - clearPush(lx, 4.6),
  (lx) => -8.3 + 0.7 * Math.sin(lx * 0.13 + 2) + jag(lx, 23, 1.6, 3.3) - clearPush(lx, 3.0),
  (lx) => -12.6 + 0.8 * Math.sin(lx * 0.11 + 0.4) + jag(lx, 37, 1.8, 3.9) - clearPush(lx, 1.6),
];
const STEPS = [0.85, 0.95, 1.0];
// the rim of the upper plateau: past it the ground drops to the far forest floor
const RIM = (lx) => -19.2 + 1.1 * Math.sin(lx * 0.09 + 1.7) + jag(lx, 41, 2.4, 4.6) + 3.2 * win(lx);
const RIM_DROP = 2.5;
const FRONTS = [
  (lx) => 4.7 + 0.45 * Math.sin(lx * 0.3) + jag(lx, 53, 0.9, 2.9),
  (lx) => 8.4 + 0.6 * Math.sin(lx * 0.23 + 1) + jag(lx, 59, 1.2, 3.4),
];
const FSTEPS = [1.1, 1.25];
const brookZ = (lx) => FRONTS[0](lx) + 1.9 + 0.35 * Math.sin(lx * 0.37 + 1);
const TOP = STEPS[0] + STEPS[1] + STEPS[2];

// local height
export function forestH(lx, lz) {
  let h = 0;
  for (let i = 0; i < 3; i++) h += STEPS[i] * smooth(0, 0.3, LEDGES[i](lx) - lz);
  h -= RIM_DROP * smooth(0, 5, RIM(lx) - lz);                      // the plateau falls away
  h += (noise2(lx * 0.07 + 5, lz * 0.07) - 0.5) * 1.4 * smooth(-22, -30, lz);   // rolling far floor
  h += 3.4 * smooth(-50, -70, lz) * (1 - 0.85 * win(lx));          // low hills at the back, parted behind the clearing
  for (let i = 0; i < 2; i++) h -= FSTEPS[i] * smooth(0, 0.3, lz - FRONTS[i](lx));
  // the brook's bed on the lower tier
  h -= 0.16 * smooth(1.25, 0.7, Math.abs(lz - brookZ(lx)));
  // the forest closes in beyond the clearing and at the west entrance edges
  h += 2.5 * smooth(0, 1.2, lx - 50) * smooth(-24, -20, lz) + 2.0 * smooth(0, 1, -12 - lx) * smooth(-24, -20, lz);
  // gentle floor undulation (keeps the path level)
  h += (noise2(lx * 0.35, lz * 0.35) - 0.5) * 0.12 * smooth(1, 3, Math.abs(lz - pathZ(lx)));
  return h;
}
// world-space ground height (for actors / collision)
export function forestGround(x, z) { return forestH(x - FOREST.x0, z - FOREST.z0); }

export const FOREST_COLLIDERS = [];   // { x, z, r } in world coords
export const MUSHROOMS = [];         // { x, y, z, col }
const BEAMS = [];                    // moonbeams: { lx, lz, big, k }
const LANTERNS = [];                 // Gerald's hoard of stolen lamp heads: { x, y, z }
const FX = { haze: null, camera: null, beamMats: [], perch: null, hidden: null };

// ---------- aerial perspective ----------
// Every forest material past the path is lifted toward moonlit mist with depth (world z behind the
// path) and a little more near the ground (mist pools low), so the groves, the plateau, the far
// forest and the hills separate into layers of decreasing contrast. Shared uniforms: one knob.
const HZ = {
  uHzCol: { value: new THREE.Color(0.05, 0.095, 0.17) },
  uHzZ: { value: new THREE.Vector4(FOREST.z0 - 5.5, 46, 0.0, 7.0) },   // start z, depth span, mist floor y, mist height
  uHzK: { value: 0.82 },
};
const HAZE_VS_DECL = 'varying vec3 vHzW;';
const HAZE_VS = `{
  vec4 hzP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  hzP = instanceMatrix * hzP;
#endif
  vHzW = ( modelMatrix * hzP ).xyz;
}`;
const HAZE_FS_DECL = 'varying vec3 vHzW; uniform vec3 uHzCol; uniform vec4 uHzZ; uniform float uHzK, uSelf;';
const HAZE_FS = `
  outgoingLight += diffuseColor.rgb * uSelf;
  {
    float hzd = clamp( ( uHzZ.x - vHzW.z ) / uHzZ.y, 0.0, 1.0 );
    hzd = hzd * ( 2.0 - hzd );
    float hzl = 1.0 - smoothstep( uHzZ.z, uHzZ.z + uHzZ.w, vHzW.y );
    outgoingLight = mix( outgoingLight, uHzCol, uHzK * hzd * ( 0.72 + 0.28 * hzl ) );
  }`;
function hazeHook(m, key, o = {}) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, HZ);
    sh.uniforms.uSelf = { value: o.self ?? 0 };
    if (o.patch) o.patch(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + HAZE_VS_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + HAZE_VS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HAZE_FS_DECL)
      .replace('#include <opaque_fragment>', HAZE_FS + '\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'fhz-' + key + '-' + (o.self ?? 0);
  return m;
}

function groundMat() {
  const mat = new THREE.MeshStandardMaterial({ map: tileTex('tex_grass'), roughness: 1, metalness: 0, vertexColors: true });
  const tDirt = tileTex('tex_dirt'), tRock = tileTex('tex_cliff');
  hazeHook(mat, 'ground', {
    patch: (sh) => {
      sh.uniforms.tDirt = { value: tDirt }; sh.uniforms.tRock = { value: tRock };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aMix; varying vec2 vMix; varying vec3 vFP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvMix = aMix; vFP = position;');
      // one texel grid: both grass samples at the same 64 px/m scale (the second rotated and offset
      // to break the tiling) instead of a magnified macro layer with 3x fatter texels
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tDirt, tRock; varying vec2 vMix; varying vec3 vFP;')
        .replace('#include <map_fragment>', `{
          vec2 uv = vFP.xz / 2.0;
          vec4 g = texture2D(map, uv);
          vec4 g2 = texture2D(map, vec2(uv.y, -uv.x) + 0.37);
          g = mix(g, g2, 0.4);
          vec4 d = texture2D(tDirt, uv);
          vec4 r = texture2D(tRock, vec2(vFP.x + vFP.z * 0.35, vFP.y * 1.3) / 2.3);
          vec4 c = mix(g * vec4(0.82, 1.0, 0.88, 1.0), d, vMix.x);
          c = mix(c, r * vec4(0.95, 1.0, 1.05, 1.0), vMix.y);
          diffuseColor *= c;
        }`);
    },
  });
  return mat;
}

function groundMesh(X0, X1, Z0, Z1, S, mat, ao) {
  const nx = Math.round((X1 - X0) / S), nz = Math.round((Z1 - Z0) / S);
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, forestH(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const mix = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const nn = noise2(x * 0.7 + 3, z * 0.7 - 1);
    const pd = Math.abs(z - pathZ(x)) - (1.15 + (nn - 0.5) * 0.7);
    const cd = Math.hypot((x - FOREST.clearX) / 1.3, z - FOREST.clearZ) - FOREST.clearR * 0.62;
    let dirt = Math.max(smooth(0.6, -0.2, pd), smooth(0.8, -0.6, cd) * 0.7);
    if (x < -4) dirt *= smooth(-9, -4, x);
    if (Math.abs(y) > 0.4 || z < -8) dirt = 0;
    dirt = Math.max(dirt, noise2(x * 0.4 + 20, z * 0.4) > 0.8 ? 0.45 : 0);
    const rock = smooth(0.8, 0.5, n.getY(i));
    mix[i * 2] = dirt; mix[i * 2 + 1] = rock;
    // contact AO at the foot of each terrace, and a darker, mossier floor away from the path
    let hi = 0;
    if (ao) for (const [dx, dz] of [[0, -0.6], [0, -1.3], [0.7, -0.7], [-0.7, -0.7]]) hi = Math.max(hi, forestH(x + dx, z + dz) - y);
    const occ = 1 - 0.55 * smooth(0.25, 1.0, hi);
    const shade = (0.8 + 0.2 * nn) * (y < -0.6 ? 0.72 : 1);
    col[i * 3] = occ * shade * 0.9; col[i * 3 + 1] = occ * shade; col[i * 3 + 2] = occ * shade * 0.96;
  }
  geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- terrace blocks ----------
// Irregular rock prisms stacked along every terrace edge: a pixel-art cliff texture on the sides
// (one 128 px tile per 2.3 m, the props' 56 px/m grid) and a mossy grass cap on top. Slightly
// different heights and depths per block give the crenellated, carved look of an HD-2D cliffside.
function terraceBlocks(R) {
  const side = { p: [], uv: [], c: [], n: [] }, top = { p: [], uv: [], c: [], n: [] };
  const TILE = 2.3;
  const block = (cx, cz, hw, hdB, hdF, y0, y1, seed) => {
    // blocks standing on the walkable floor are solid
    if (y0 <= 0.1 && y1 >= -0.05) {
      const r = Math.min(hw, (hdB + hdF) / 2) * 0.95;
      for (const k of (hw > r * 1.3 ? [-0.5, 0.5] : [0])) FOREST_COLLIDERS.push({ x: FOREST.x0 + cx + k * hw, z: FOREST.z0 + cz + (hdF - hdB) / 2, r });
    }
    const N = 9, ring = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + 0.2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // rounded box footprint, front (+z) and back depths differ
      const sx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.55), sz = Math.sign(sa) * Math.pow(Math.abs(sa), 0.55);
      const j = 0.85 + 0.3 * hash2(seed + k, 7.7);
      ring.push([cx + sx * hw * j, cz + sz * (sz > 0 ? hdF : hdB) * (0.85 + 0.25 * hash2(seed, k + 3))]);
    }
    let per = hash2(seed, 1.1) * TILE;
    for (let k = 0; k < N; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % N];
      const len = Math.hypot(bx - ax, bz - az);
      const u0 = per / TILE, u1 = (per + len) / TILE; per += len;
      const v0 = y0 / TILE, v1 = y1 / TILE;
      let nx = bz - az, nz = -(bx - ax); const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      side.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
      for (let q = 0; q < 6; q++) side.n.push(nx, 0, nz);
      side.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      const lo = 0.34, hi = 0.95;
      side.c.push(lo, lo, lo, lo, lo, lo, hi, hi, hi, lo, lo, lo, hi, hi, hi, hi, hi, hi);
    }
    for (let k = 0; k < N; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % N];
      top.p.push(cx, y1, cz, bx, y1, bz, ax, y1, az);
      for (let q = 0; q < 3; q++) top.n.push(0, 1, 0);
      top.uv.push(cx / 2, cz / 2, bx / 2, bz / 2, ax / 2, az / 2);
      top.c.push(1.25, 1.3, 1.25, 1.05, 1.1, 1.05, 1.05, 1.1, 1.05);
    }
  };
  let seed = 1;
  const edges = [];
  for (let i = 0; i < 3; i++) {
    let base = 0; for (let k = 0; k < i; k++) base += STEPS[k];
    edges.push({ f: LEDGES[i], lo: base, hi: base + STEPS[i], back: true });
  }
  edges.push({ f: FRONTS[0], lo: -FSTEPS[0], hi: 0, back: false });
  edges.push({ f: FRONTS[1], lo: -FSTEPS[0] - FSTEPS[1], hi: -FSTEPS[0], back: false });
  for (const e of edges) {
    for (let lx = -16; lx < 64;) {
      const w = 1.0 + R() * 1.5;
      const x = lx + w / 2;
      const ez = e.f(x);
      if (x < -11 && !e.back) { lx += w; continue; }
      const tall = !e.back ? R() * 0.04 : R() < 0.28 ? 0.2 + R() * 0.45 : R() * 0.12;
      const y1 = e.hi + tall, y0 = e.lo - 0.35;
      block(x, ez - 0.55, w * 0.62, 0.75, 0.75, y0, y1, seed++);
      if (R() < 0.35) {
        const sw = 0.4 + R() * 0.6, sx = x + (R() - 0.5) * w;
        const sh = (e.hi - e.lo) * (0.35 + R() * 0.3);
        block(sx, ez + 0.35 + R() * 0.25, sw, 0.4, 0.35, e.lo - 0.3, e.lo + sh, seed++);
      }
      lx += w * (0.82 + R() * 0.2);
    }
  }
  // the plateau's rim: a crenellated line of boulders and slabs where it drops to the far floor,
  // reading as a silhouette against the mist behind
  for (let lx = -16; lx < 66;) {
    const w = 1.2 + R() * 1.8, x = lx + w / 2, rz = RIM(x) + 0.6;
    const y1 = forestH(x, rz + 0.8) + (R() < 0.4 ? 0.35 + R() * 0.7 : 0.1 + R() * 0.2);
    block(x, rz, w * 0.6, 0.8, 0.8, y1 - 2.2, y1, seed++);
    lx += w * (0.9 + R() * 0.5);
  }
  const mk = (s, map, tint, key) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(s.c, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(s.n, 3));
    const m = hazeHook(new THREE.MeshStandardMaterial({ map, color: tint, roughness: 1, metalness: 0, vertexColors: true, side: THREE.DoubleSide }), key);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  };
  return [mk(side, tileTex('tex_cliff'), new THREE.Color(0.86, 0.92, 1.0), 'blk-side'), mk(top, tileTex('tex_grass'), new THREE.Color(0.74, 0.86, 0.76), 'blk-top')];
}

// small pixel grass tufts (instanced): 24 texels over 0.43 m, the ground's ~56 px/m
function tuftTex(variant) {
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const g = c.getContext('2d');
  const R = rng(5000 + variant * 31);
  const shades = [['#244a2c', '#2f5a34', '#3f7040', '#5a904a', '#88b464'], ['#22422c', '#2c5236', '#3a6640', '#4f8048', '#7aa65c'], ['#1f3a32', '#28463a', '#335c46', '#4a7c5e', '#7cac8c']][variant % 3];
  for (let b = 0; b < 17; b++) {
    const x = 2 + Math.floor(R() * 20), hh = 7 + Math.floor(R() * 15), lean = R() < 0.5 ? -1 : 1;
    for (let k = 0; k < hh; k++) {
      const xx = x + (k > hh * 0.55 ? lean : 0) + (k > hh * 0.85 ? lean : 0);
      g.fillStyle = shades[Math.min(4, Math.floor(k / hh * 5))]; g.fillRect(xx, 23 - k, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.name = 'tuft';
  return t;
}

// ---------- sprites ----------
const nrmUp = (geo) => { const nrm = geo.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 0.86, 0.51); };
const depthCache = new Map();
function depthFor(tex) {
  let d = depthCache.get(tex);
  if (!d) {
    d = {
      depth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
      dist: new THREE.MeshDistanceMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
    };
    depthCache.set(tex, d);
  }
  return d;
}
// a sprite made from a registered procedural frame
const procMats = new Map();
function procSprite(key, h, opts = {}) {
  const f = frame(key);
  const w = h * f.w / f.h;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2, 0);
  nrmUp(geo);
  if (opts.flip) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
  const mk = key + '|' + (opts.emissive || 0) + '|' + (opts.self || 0);
  let m = procMats.get(mk);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: f.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    if (f.emis && opts.emissive) { m.emissiveMap = f.emis; m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = opts.emissive; }
    hazeHook(m, 'spr', { self: opts.self || 0 });
    procMats.set(mk, m);
  }
  const s = new THREE.Mesh(geo, m);
  s.castShadow = opts.castShadow ?? true; s.receiveShadow = true;
  const d = depthFor(f.tex); s.customDepthMaterial = d.depth; s.customDistanceMaterial = d.dist;
  if (!opts.noOcclude) s.userData.size = [w, h];
  return s;
}

// Trees: individual billboards near the path (they can be hidden by the occluder logic), and for the
// far layers one merged mesh per texture (hundreds of trees in a handful of draw calls).
const treeMats = new Map();
function treeMat(key, self, batched) {
  const mk = key + '|' + self + '|' + (batched ? 'b' : 'i');
  let m = treeMats.get(mk);
  if (!m) {
    const f = frame(key);
    m = new THREE.MeshStandardMaterial({ map: f.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0, vertexColors: true });
    hazeHook(m, 'tree' + (batched ? 'b' : ''), { self });
    treeMats.set(mk, m);
  }
  return m;
}
function treeMesh(kind, h, flip, o = {}) {
  const key = treeKey(kind, h, o.pick ?? 0);
  const f = frame(key);
  const w = h * f.w / f.h;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2 - 0.04, 0);
  nrmUp(geo);
  if (flip) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
  const tc = new THREE.Color(o.tint ?? 0xffffff), cols = [];
  for (let i = 0; i < 4; i++) cols.push(tc.r, tc.g, tc.b);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, treeMat(key, o.self ?? 0.03, false));
  m.castShadow = o.castShadow ?? true; m.receiveShadow = true;
  const d = depthFor(f.tex); m.customDepthMaterial = d.depth; m.customDistanceMaterial = d.dist;
  m.userData.size = [w, h];
  m.userData.sprite = 'forest-' + kind;
  return m;
}
class TreeBatch {
  constructor() { this.by = new Map(); }
  add(kind, lx, y, lz, h, flip, tint, pick) {
    const key = treeKey(kind, h, pick);
    const f = frame(key), w = h * f.w / f.h;
    let b = this.by.get(key);
    if (!b) this.by.set(key, b = { p: [], uv: [], c: [], n: [], i: [] });
    const v = b.p.length / 3;
    const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1;
    b.p.push(lx - w / 2, y - 0.05, lz, lx + w / 2, y - 0.05, lz, lx + w / 2, y + h - 0.05, lz, lx - w / 2, y + h - 0.05, lz);
    b.uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    for (let k = 0; k < 4; k++) { b.c.push(tint.r, tint.g, tint.b); b.n.push(0, 0.86, 0.51); }
    b.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  meshes(self) {
    const out = [];
    for (const [key, b] of this.by) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setIndex(b.i);
      const m = new THREE.Mesh(g, treeMat(key, self, true));
      m.castShadow = false; m.receiveShadow = true;
      out.push(m);
    }
    return out;
  }
}

function signTexture(lines) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const v = 120 + ((y >> 2) % 2) * 14 + ((x * 7 + y * 3) % 9) - (y % 8 === 0 ? 30 : 0);
    g.fillStyle = `rgb(${v},${v * 0.72 | 0},${v * 0.5 | 0})`; g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = '#3a2416'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 31, 64, 1); g.fillRect(0, 0, 1, 32); g.fillRect(63, 0, 1, 32);
  g.fillStyle = '#f4e6c0'; g.font = 'bold 9px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, 32, 11 + i * 11));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

// ---------- visible light: moonbeam shafts, their landings, and the mist between the layers ----------
// A beam is a trapezoid (narrow where it leaves the canopy, wide where it lands) holding two or three
// sub-shafts of different width and strength; it fades in below the canopy, is strongest in its lower
// half, thins as it spreads, and lands as a dappled pale pool on the ground.
const BEAM_VS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FS = `
uniform vec3 uCol; uniform float uK, uTime, uSeed, uSpread;
varying vec2 vUv;
float hh(float n){ return fract(sin(n * 91.7 + uSeed * 13.13) * 43758.5453); }
void main(){
  float x = vUv.x, v = vUv.y;
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float c = 0.22 + 0.56 * hh(fi * 3.1 + 1.0) + 0.03 * sin(uTime * 0.15 + fi * 2.0 + uSeed);
    float w = 0.08 + 0.14 * hh(fi * 5.7 + 2.0);
    float s = 0.3 + 0.7 * hh(fi * 7.3 + 3.0);
    float d = (x - c) / w;
    a += s * exp(-d * d);
  }
  float body = 1.0 - abs(x * 2.0 - 1.0);
  a = a * 0.75 + 0.3 * body * body;
  a *= smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x);
  // dust drifting through it
  a *= 0.85 + 0.15 * sin(x * 37.0 + uSeed * 7.0 + uTime * 0.3 + v * 5.0);
  // fades in below the canopy, strongest low down, softening into the floor
  float along = smoothstep(1.0, 0.4, v) * (0.45 + 0.55 * smoothstep(0.0, 0.22, v)) * (1.2 - 0.7 * v);
  // the same light spread over a wider shaft near the ground
  float spread = mix(uSpread, 1.0, v);
  gl_FragColor = vec4(uCol * a * along * spread * uK, 1.0);
}`;
function beamMesh(len, w0, w1, k, col, seed) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w1 / 2, 0, 0, w1 / 2, 0, 0, w0 / 2, len, 0, -w0 / 2, len, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new THREE.ShaderMaterial({
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
    uniforms: { uCol: { value: col }, uK: { value: k }, uTime: { value: 0 }, uSeed: { value: seed }, uSpread: { value: Math.sqrt(w0 / w1) } },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  FX.beamMats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 5;
  return mesh;
}
const texCache = {};
function glowTexture() {
  if (texCache.glow) return texCache.glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (texCache.glow = new THREE.CanvasTexture(c));
}
// a moon pool: soft oval with a brighter, dappled core (light through leaves), on a 56 px/m-ish grid
function poolTexture(seed) {
  const key = 'pool' + seed;
  if (texCache[key]) return texCache[key];
  const W = 96, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), d = g.createImageData(W, H);
  const R = rng(seed);
  const spots = []; for (let k = 0; k < 9; k++) spots.push([0.2 + R() * 0.6, 0.25 + R() * 0.5, 0.04 + R() * 0.07]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    const r = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
    let a = Math.max(0, 1 - r) ** 1.6 * 0.75;
    for (const [sx, sy, sr] of spots) { const q = Math.hypot((u - sx) / sr, (v - sy) / (sr * 1.5)); if (q < 1) a += 0.35 * (1 - q * q) * Math.max(0, 1 - r); }
    a = Math.min(1, a);
    // quantise to a few steps (pixel-art light, not an airbrush)
    a = Math.round(a * 7) / 7;
    const o = (y * W + x) * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = 255; d.data[o + 3] = a * 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return (texCache[key] = t);
}
function decal(tex, w, d, col, k) {
  const m = new THREE.MeshBasicMaterial({ map: tex, color: col.clone().multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 3;
  return mesh;
}
function glowCard(size, col, k) {
  const m = new THREE.MeshBasicMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), m);
  mesh.renderOrder = 4;
  return mesh;
}
// a mist sheet: a wide vertical plane, brightest a little above its foot and fading upward, broken
// into soft banks; additive, so it lifts everything behind it (the layers stack up in haze)
function mistTexture(seed) {
  const key = 'mist' + seed;
  if (texCache[key]) return texCache[key];
  const W = 256, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), d = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 1 - (y + 0.5) / H;                                   // 0 foot .. 1 top
    const bank = 0.45 + 0.55 * noise2(x * 0.035 + seed * 7, v * 1.5 + seed);
    const prof = smooth(0, 0.12, v) * Math.pow(1 - v, 2.2);
    const a = Math.min(1, prof * bank * 1.25) * smooth(0, 0.08, Math.min(x, W - 1 - x) / W * 2);
    const o = (y * W + x) * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = 255; d.data[o + 3] = a * 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return (texCache[key] = t);
}

export function buildForest(ctx) {
  const X = FOREST.x0, Z = FOREST.z0;
  const group = new THREE.Group();
  group.position.set(X, 0, Z);
  ctx.scene.add(group);
  ctx.forestGroup = group;
  const low = quality.name === 'low';
  const gmat = groundMat();
  group.add(groundMesh(-16, 64, -26, 16, low ? 0.5 : 0.35, gmat, true));
  group.add(groundMesh(-46, 96, -80, -25.5, low ? 1.8 : 1.1, gmat, false));
  const R = rng(777);
  for (const m of terraceBlocks(rng(4040))) group.add(m);
  const W = (lx, lz) => [X + lx, Z + lz];
  const on = (lx, lz) => forestH(lx, lz);
  const put = (obj, lx, lz, dy = 0) => { obj.position.set(lx, on(lx, lz) + dy, lz); group.add(obj); return obj; };
  const trees = [];
  const far = new TreeBatch();
  const tree = (lx, lz, h, kind, flip, o = {}) => {
    if (o.avoid !== false && trees.some(t => Math.abs(t[0] - lx) < (kind === 'pine' ? 1.5 : 2.1) && Math.abs(t[1] - lz) < 1.1)) return null;
    const s = treeMesh(kind, h, flip, { self: o.self ?? 0.06, tint: o.tint, pick: Math.floor(R() * 4) });
    put(s, lx, lz);
    trees.push([lx, lz]);
    const [w] = s.userData.size;
    group.add(blobShadow(lx, on(lx, lz), lz, w * 0.26, w * 0.16, 0.6));
    if (Math.abs(on(lx, lz)) < 0.5) { const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: kind === 'pine' ? 0.45 : 0.55 }); }
    return s;
  };
  const nearPath = (lx, lz, m) => Math.abs(lz - pathZ(lx)) < m || Math.hypot((lx - FOREST.clearX) / 1.2, lz - FOREST.clearZ) < FOREST.clearR + m - 1.5;
  const kindOf = (p) => R() < p ? 'pine' : 'broad';
  const dens = low ? 0.55 : 1;

  // --- far layers (merged): the far forest floor beyond the rim, then the low hills ---
  const farTint = new THREE.Color();
  for (let i = 0; i < 300 * dens; i++) {
    const lx = -44 + R() * 138, lz = -24 - R() * 34;
    if (lz > RIM(lx) - 3.5) continue;
    // clumps with gaps: thin out where a slow noise is low, and keep the window behind the clearing open
    if (noise2(lx * 0.09 + 3, lz * 0.11) < 0.38) continue;
    if (win(lx) > 0.3 && R() < 0.85 * win(lx)) continue;
    const h = 8 + R() * 4;
    farTint.setRGB(0.78 + R() * 0.1, 0.84 + R() * 0.1, 0.95);
    far.add(R() < 0.82 ? 'pine' : 'broad', lx, on(lx, lz), lz, h, R() < 0.5, farTint, R() * 4);
  }
  for (let i = 0; i < 150 * dens; i++) {
    const lx = -46 + R() * 142, lz = -58 - R() * 18;
    if (win(lx) > 0.2 && R() < 0.95 * win(lx)) continue;
    if (noise2(lx * 0.06 - 9, lz * 0.1) < 0.33) continue;
    farTint.setRGB(0.7, 0.78, 0.92);
    far.add('pine', lx, on(lx, lz), lz, 9 + R() * 3.5, R() < 0.5, farTint, R() * 4);
  }
  // --- mid layer: groves on the upper plateau, and a ragged line of pines along its rim ---
  for (let i = 0; i < 110 * dens; i++) {
    const lx = -16 + R() * 82;
    const zf = LEDGES[2](lx) - 1.0, zb = RIM(lx) + 0.4;
    if (zb > zf) continue;
    const lz = zb + R() * (zf - zb);
    if (noise2(lx * 0.16 + 11, 2.5) < 0.36) continue;            // grove / gap rhythm
    if (win(lx) > 0.5 && R() < 0.8) continue;
    tree(lx, lz, 6.6 + R() * 3.2, kindOf(0.68), R() < 0.5, { self: 0.02, tint: 0xc4d0e2 });
  }
  // --- near groves on the two lower terraces (smaller trees, clusters with open ground between) ---
  const groveP = [0.26, 0.4];
  for (let t = 0; t < 2; t++) {
    for (let gx = -14; gx < 62; gx += 3.5 + R() * 4) {
      if (R() > groveP[t]) continue;
      if (Math.abs(gx - FOREST.clearX) < 4.5) continue;
      const n = 1 + Math.floor(R() * (t === 0 ? 2 : 3));
      for (let k = 0; k < n; k++) {
        const lx = gx + (R() - 0.5) * 3.2;
        const zFront = LEDGES[t](lx) - 0.9, zBack = LEDGES[t + 1](lx) + 0.5;
        if (zBack > zFront) continue;
        const lz = zBack + R() * (zFront - zBack);
        const kind = kindOf(0.55);
        tree(lx, lz, (kind === 'pine' ? 5.4 + R() * 2.4 : 4.4 + R() * 1.8) * (t ? 1.05 : 0.9), kind, R() < 0.5, { tint: t ? 0xe2e8f2 : 0xffffff });
      }
    }
  }
  // --- a few big trees on the floor between the path and the first terrace ---
  for (let lx = -6; lx < 52; lx += 10 + R() * 7) {
    if (Math.abs(lx - FOREST.clearX) < 7) continue;
    const lz = LEDGES[0](lx) + 0.7 + R() * 0.6;
    if (nearPath(lx, lz, 2.0)) continue;
    const kind = kindOf(0.6);
    tree(lx, lz, kind === 'pine' ? 6.6 + R() * 2 : 5.4 + R() * 1.4, kind, R() < 0.5);
  }
  // --- the near side of the path: occasional trees, mostly toward the drop ---
  for (let lx = -8; lx < 50; lx += 9 + R() * 8) {
    const lz = FRONTS[0](lx) - 0.8 - R() * 0.8;
    if (nearPath(lx, lz, 2.6) || on(lx, lz) > 0.4 || on(lx, lz) < -0.3) continue;
    tree(lx, lz, 5 + R() * 2, kindOf(0.5), R() < 0.5);
  }
  // --- big, dark foreground trunks and bushes on the lower tiers (frame the shot, DOF-blurred) ---
  for (let lx = -12; lx < 60; lx += 5 + R() * 6) {
    const lz = FRONTS[0](lx) + 1.0 + R() * 4.5;
    put(treeMesh(R() < 0.6 ? 'pine' : 'broad', 7.5 + R() * 3, R() < 0.5, { self: 0.01, tint: 0x6a7486 }), lx, lz);
  }
  for (let i = 0; i < (low ? 30 : 60); i++) {
    const lx = -12 + R() * 72, lz = FRONTS[0](lx) + 0.4 + R() * 7;
    const h = 0.9 + R() * 1.1;
    put(makeSprite(pxName('bush', h), { h, yaw: 0, flip: R() < 0.5, selfLight: 0.015, tint: 0x8a96a6 }), lx, lz);
  }
  // --- west entrance: an arch of trees either side of the road ---
  for (const [lx, lz, h, k] of [[-4.5, -2.6, 7.2, 'pine'], [-5.2, 2.6, 6.2, 'broad'], [-8.5, -1.8, 7.8, 'pine'], [-9.0, 3.0, 7.0, 'pine'], [-3.0, 3.6, 5.4, 'broad']]) tree(lx, lz, h, k, R() < 0.5, { avoid: false });
  // --- the clearing: an open ring of broadleaf and dead trees well back, the window behind Gerald ---
  for (let a = -0.15; a < Math.PI + 0.3; a += 0.36) {
    const rr = 9.2 + R() * 1.5;
    const lx = FOREST.clearX + Math.cos(a) * rr * 1.15, lz = FOREST.clearZ - Math.sin(a) * rr * 0.9;
    if (Math.abs(a - Math.PI / 2) < 0.62) continue;
    const kind = R() < 0.25 ? 'dead' : kindOf(0.45);
    tree(lx, lz, kind === 'dead' ? 5 + R() * 1.5 : 6 + R() * 2.5, kind, R() < 0.5);
  }
  for (const [lx, lz] of [[49, 1.5], [48.5, -3], [47.5, 4], [51, -1]]) tree(lx, lz, 6.5 + R() * 2, 'pine', R() < 0.5, { avoid: false });
  for (const m of far.meshes(0.012)) group.add(m);

  // --- undergrowth: bushes, flowers, boulders and stumps on the floor and the terrace tops ---
  for (let i = 0; i < (low ? 160 : 280); i++) {
    const lx = -12 + R() * 66, lz = -17 + R() * 22;
    const hgt = on(lx, lz);
    if (nearPath(lx, lz, 1.9)) continue;
    if (lz < RIM(lx) + 1.2) continue;
    let nearEdge = false;
    for (const f of LEDGES) if (Math.abs(lz - f(lx)) < 0.75 || (lz > f(lx) - 1.2 && lz < f(lx))) nearEdge = true;
    if (nearEdge || Math.abs(on(lx + 0.3, lz) - hgt) > 0.15) continue;
    const floor = Math.abs(hgt) < 0.4;
    const k = R();
    // keep the strip in front of the path low: battles are staged on it, seen from the front
    const ahead = lz - pathZ(lx);
    if (floor && ahead > 0 && ahead < 3.4 && (k < 0.42 || k >= 0.7)) continue;
    if (k < 0.42) { const h = 0.6 + R() * 0.7; put(makeSprite(pxName('bush', h), { h, yaw: 0, flip: R() < 0.5, selfLight: 0.03 }), lx, lz); group.add(blobShadow(lx, hgt, lz, h * 0.6, h * 0.35, 0.45)); }
    else if (k < 0.7) put(makeSprite(pxName('flowers', 0.45), { h: 0.42 + R() * 0.12, yaw: 0, flip: R() < 0.5, selfLight: 0.05, castShadow: false }), lx, lz);
    else if (k < 0.9) {
      const v = Math.floor(R() * 6), f = frame('rock_' + v), h = f.h / 56;
      put(procSprite('rock_' + v, h, { flip: R() < 0.5 }), lx, lz); group.add(blobShadow(lx, hgt, lz, h * 0.95, h * 0.45, 0.75));
      if (floor) { const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: h * 0.75 }); }
    } else {
      const s = procSprite('stump', 0.62, { flip: R() < 0.5 });
      put(s, lx, lz); group.add(blobShadow(lx, hgt, lz, 0.5, 0.28, 0.7));
      if (floor) { const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: 0.42 }); }
    }
  }
  // boulders tumbled at the foot of the first terrace
  for (let i = 0; i < 26; i++) {
    const lx = -10 + R() * 60, lz = LEDGES[0](lx) + 0.75 + R() * 0.4;
    if (nearPath(lx, lz, 1.6)) continue;
    const v = Math.floor(R() * 6), h = frame('rock_' + v).h / 56;
    put(procSprite('rock_' + v, h, { flip: R() < 0.5 }), lx, lz);
    group.add(blobShadow(lx, on(lx, lz), lz, h * 0.95, h * 0.45, 0.75));
    const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: h * 0.7 });
  }

  // --- glowing mushrooms: clusters along the path, on the terraces and a ring round the clearing ---
  const mush = (lx, lz, pool) => {
    const k = Math.floor(R() * 6), f = frame('mush_' + k);
    const s = procSprite('mush_' + k, (f.h / 56) * (0.9 + R() * 0.2), { emissive: 1.5, castShadow: false, flip: R() < 0.5, noOcclude: true });
    put(s, lx, lz);
    const c = new THREE.Color(f.col[0] / 255, f.col[1] / 255, f.col[2] / 255);
    const [wx, wz] = W(lx, lz);
    if (pool) MUSHROOMS.push({ x: wx, y: on(lx, lz) + 0.4, z: wz, col: c });
  };
  for (let lx = 0; lx < 36; lx += 2.4 + R() * 2.2) {
    const side = R() < 0.5 ? -1 : 1;
    const lz = pathZ(lx) + side * (1.8 + R() * 1.2);
    if (Math.abs(on(lx, lz)) > 0.4) continue;
    mush(lx, lz, true);
    if (R() < 0.7) mush(lx + 0.35, lz + 0.25, false);
    if (R() < 0.4) mush(lx - 0.3, lz + 0.15, false);
  }
  for (let i = 0; i < 9; i++) {               // patches up on the terraces light the cliff tops
    const lx = -6 + i * 6 + R() * 3, t = Math.floor(R() * 2);
    const lz = LEDGES[t](lx) - 1.3 - R() * 1.0;
    if (Math.abs(lx - FOREST.clearX) < 4.5) continue;
    mush(lx, lz, true); mush(lx + 0.3, lz + 0.2, false);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.5) {
    const lx = FOREST.clearX + Math.cos(a) * (5.2 + R() * 1.0), lz = FOREST.clearZ + Math.sin(a) * (4.0 + R() * 0.7);
    if (Math.abs(on(lx, lz)) > 0.4) continue;
    mush(lx, lz, a % 1.0 < 0.5);
    if (R() < 0.6) mush(lx + 0.3, lz + 0.2, false);
  }

  // --- Gerald's roost: an old mossy stump right under where he hovers ---
  const PX = FOREST.clearX + 0.2, PZ = FOREST.clearZ - 1.45;
  {
    const s = procSprite('perch', 1.0, { noOcclude: true, self: 0.02 });
    put(s, PX, PZ);
    const sh = blobShadow(PX, on(PX, PZ), PZ, 0.8, 0.4, 0.85);
    group.add(sh);
    FX.perch = [s, sh];
    const [wx, wz] = W(PX, PZ); FOREST_COLLIDERS.push({ x: wx, z: wz, r: 0.5 });
  }
  // his hoard: stolen lamp heads piled round the stump (mostly behind and to the sides, so the boss
  // stage in front stays clear), still glowing - the clearing's warm focal light against the blue
  const HOARD = [[-1.5, 0.3, 0], [1.6, 0.2, 1], [-0.75, -0.75, 2], [2.4, -0.8, 0], [-2.35, -0.45, 1], [0.95, -0.95, 2], [-1.05, 0.95, 1], [2.0, 0.85, 2], [0.15, -1.25, 0]];
  HOARD.forEach(([dx, dz, k], i) => {
    const lx = PX + dx, lz = PZ + dz;
    put(procSprite('lantern_' + k, 0.48 + (i % 3) * 0.05, { emissive: 2.4, flip: dx < 0, noOcclude: true, self: 0.05 }), lx, lz);
    group.add(blobShadow(lx, on(lx, lz), lz, 0.24, 0.14, 0.85));
    LANTERNS.push({ x: X + lx, y: on(lx, lz) + 0.35, z: Z + lz, main: i < 5 });
  });
  // the warm light they throw on the floor: a stepped amber pool under the hoard
  {
    const d = decal(poolTexture(91), 7.5, 5.0, new THREE.Color(1.0, 0.5, 0.18), 0.5);
    d.position.set(PX, on(PX, PZ) + 0.035, PZ + 0.2);
    group.add(d);
    FX.hoardGlow = d;
  }
  // flowers scattered through the clearing (pale moonflowers, a lighter floor than the woods)
  for (let i = 0; i < (low ? 26 : 44); i++) {
    const a = R() * Math.PI * 2, r = 1.5 + R() * 4.8;
    const lx = FOREST.clearX + Math.cos(a) * r * 1.2, lz = FOREST.clearZ + Math.sin(a) * r * 0.8;
    if (Math.abs(on(lx, lz)) > 0.3 || Math.abs(lz - pathZ(lx)) < 1.7) continue;
    put(makeSprite(pxName('flowers', 0.45), { h: 0.4 + R() * 0.14, yaw: 0, flip: R() < 0.5, selfLight: 0.08, castShadow: false }), lx, lz);
  }
  // --- signpost at the entrance ---
  {
    const lx = 1.2, lz = pathZ(1.2) - 1.9;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x5a3c28, roughness: 1 }));
    post.position.set(lx, on(lx, lz) + 0.6, lz); post.castShadow = true; group.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(['WHISPER-', 'WOOD']), roughness: 1, side: THREE.DoubleSide }));
    board.position.set(lx, on(lx, lz) + 1.05, lz + 0.06); board.castShadow = true; group.add(board);
    const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: 0.3 });
    FOREST.sign = { x: wx, z: wz };
  }

  // --- a moonlit brook along the lower tier, with stones on its banks and glow-caps by the water ---
  {
    const N = low ? 160 : 320, x0 = -16, x1 = 64, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const lx = x0 + (x1 - x0) * i / N, zc = brookZ(lx), hw = 0.75 + 0.25 * Math.sin(lx * 0.53);
      pos.push(lx, -FSTEPS[0] + 0.06, zc - hw, lx, -FSTEPS[0] + 0.06, zc + hw);
      uv.push(lx, 0, lx, 1);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec2 p = floor(vec2(vP.x * 56.0, vP.z * 56.0));            // the shared 56 px/m grid
          vec2 q = p * 0.25;
          float e = min(vUv.y, 1.0 - vUv.y);
          vec3 c = mix(vec3(0.006, 0.014, 0.026), vec3(0.01, 0.024, 0.045), smoothstep(0.0, 0.5, e));
          float flow = sin(q.x * 0.45 - uTime * 2.2 + sin(q.y * 0.9) * 2.0) * sin(q.x * 0.17 + q.y * 0.6 - uTime * 1.3);
          c += vec3(0.018, 0.04, 0.07) * step(0.72, flow);
          float gl = h(vec2(p.x - floor(uTime * 12.0), floor(p.y / 2.0)));
          c += vec3(0.25, 0.4, 0.6) * step(0.996, gl);                 // moon glints drifting downstream
          c = mix(vec3(0.03, 0.045, 0.055), c, smoothstep(0.03, 0.1, e)); // wet bank edge
          gl_FragColor = vec4(c, 1.0);
        }`,
      uniforms: { uTime: { value: 0 } },
    });
    FX.beamMats.push(m);
    const brook = new THREE.Mesh(g, m);
    group.add(brook);
    for (let lx = -14; lx < 62; lx += 0.8 + R() * 1.8) {
      for (const sd of [-1, 1]) {
        if (R() < 0.45) continue;
        const lz = brookZ(lx) + sd * (0.85 + R() * 0.35), v = Math.floor(R() * 6), h = frame('rock_' + v).h / 56 * (0.5 + R() * 0.4);
        put(procSprite('rock_' + v, h, { flip: R() < 0.5, noOcclude: true, castShadow: false }), lx, lz);
      }
      if (R() < 0.18) { const lz = brookZ(lx) - 1.3 - R() * 0.4; const k = Math.floor(R() * 6), f = frame('mush_' + k); put(procSprite('mush_' + k, f.h / 56, { emissive: 1.5, castShadow: false, flip: R() < 0.5, noOcclude: true }), lx, lz); }
      if (R() < 0.3) { const lz = brookZ(lx) + (R() < 0.5 ? -1 : 1) * (1.4 + R() * 0.6), hh = 0.5 + R() * 0.5; put(makeSprite(pxName('bush', hh), { h: hh, yaw: 0, flip: R() < 0.5, selfLight: 0.02, tint: 0x9aa6b6 }), lx, lz); }
    }
  }

  // --- moonbeams through the canopy gaps: varied, tapering, dimmer with depth, landing as pools ---
  const MOONC = new THREE.Color(0.62, 0.8, 1.0);
  const beam = (lx, lz, len, w0, w1, k, big = false) => {
    const depth = smooth(-1, -16, lz);                         // beams further back are fainter
    const kk = k * (1 - 0.55 * depth);
    const m = beamMesh(len, w0, w1, kk, MOONC, R() * 10);
    m.position.set(lx, on(lx, lz) - 0.05, lz);
    m.rotation.z = -0.3 - R() * 0.06;                          // slanting down from the upper left
    group.add(m);
    // where it lands: a dappled pale pool, offset with the slant
    const pw = w1 * 1.15, pd = w1 * 0.75;
    const d = decal(poolTexture(7 + BEAMS.length), pw, pd, new THREE.Color(0.6, 0.78, 1.0), (big ? 0.24 : 0.3) * (1 - 0.5 * depth));
    d.position.set(lx + 0.15, on(lx, lz) + 0.03 + BEAMS.length * 0.002, lz);
    group.add(d);
    BEAMS.push({ lx, lz, big, k: 1 - 0.55 * depth });
  };
  for (let lx = 3; lx < 36; lx += 7.5 + R() * 3.5) {
    const lz = pathZ(lx) - 0.4 + (R() - 0.5) * 1.2;
    const wide = 2.2 + R() * 1.6;
    beam(lx, lz, 10 + R() * 3, wide * (0.38 + R() * 0.15), wide, 0.13 + R() * 0.09);
  }
  // fainter shafts falling on the terraces and the plateau (depth cues between the layers)
  for (let lx = -2; lx < 56; lx += 9 + R() * 6) {
    if (Math.abs(lx - FOREST.clearX) < 6) continue;
    const t = Math.floor(R() * 3);
    const lz = t < 2 ? (LEDGES[t](lx) + LEDGES[t + 1](lx)) / 2 : (LEDGES[2](lx) + RIM(lx)) / 2;
    const wide = 1.8 + R() * 1.4;
    beam(lx, lz, 9 + R() * 3, wide * 0.4, wide, 0.12 + R() * 0.06);
  }
  // the clearing's open sky: one broad shaft and a narrow companion
  beam(FOREST.clearX - 0.4, FOREST.clearZ - 0.2, 14, 3.0, 7.0, 0.17, true);
  beam(FOREST.clearX - 2.2, FOREST.clearZ - 1.6, 13, 1.2, 2.6, 0.1);
  // --- mist between the layers: additive sheets that lift everything behind them ---
  const MISTC = new THREE.Color(0.32, 0.5, 0.8);
  const SHEETS = [[-10.6, 0.05, 7, 1], [-16.5, 0.06, 8, 2], [-24, 0.075, 10, 3], [-36, 0.08, 12, 4], [-52, 0.09, 14, 5]];
  for (const [z, k, hgt, sd] of (low ? SHEETS.filter((e, i) => i % 2 === 0).map(e => [e[0], e[1] * 1.5, e[2], e[3]]) : SHEETS)) {
    let ymin = 1e9;
    for (let lx = -40; lx <= 90; lx += 2) ymin = Math.min(ymin, on(lx, z));
    const m = new THREE.MeshBasicMaterial({ map: mistTexture(sd), color: MISTC.clone().multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    m.map.repeat.set(1, 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, hgt), m);
    mesh.position.set(24, ymin - 0.4 + hgt / 2, z);
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  // the light at the end of the woods: a luminous haze glowing in the window behind the clearing
  {
    const g = glowCard([30, 14], new THREE.Color(0.5, 0.68, 1.0), 0.32);
    g.position.set(FOREST.clearX - 1, on(FOREST.clearX, -40) + 4, -40);
    group.add(g);
    for (let lx = -6; lx < 60; lx += 12 + R() * 6) {
      if (win(lx) > 0.2) continue;
      const lz = RIM(lx) - 8 - R() * 8;
      const c = glowCard([12 + R() * 6, 6 + R() * 3], new THREE.Color(0.45, 0.65, 1.0), 0.16);
      c.position.set(lx, on(lx, lz) + 2.5 + R() * 1.5, lz);
      group.add(c);
    }
  }

  // --- grass tufts ---
  const per = Math.floor(quality.tufts * 0.2);
  const dummy = new THREE.Object3D();
  for (let v = 0; v < 3; v++) {
    const geo = new THREE.PlaneGeometry(0.43, 0.43); geo.translate(0, 0.215, 0);
    const nn = geo.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    const im = new THREE.InstancedMesh(geo, hazeHook(new THREE.MeshStandardMaterial({ map: tuftTex(v), alphaTest: 0.5, roughness: 1 }), 'tuft'), per);
    let n = 0;
    for (let i = 0; i < per * 6 && n < per; i++) {
      const lx = -12 + R() * 68, lz = -18 + R() * 30;
      if (nearPath(lx, lz, 1.3) && R() < 0.9) continue;
      if (lz < RIM(lx) + 0.8) continue;
      if (noise2(lx * 0.45 + 7, lz * 0.45 - 3) < 0.42 + 0.2 * R()) continue;          // grass grows in patches
      const y = on(lx, lz);
      if (Math.abs(on(lx, lz - 0.4) - y) > 0.12 || Math.abs(on(lx, lz + 0.4) - y) > 0.12) continue;   // not on faces
      const s = 0.85 + R() * 0.3;
      dummy.position.set(lx, y, lz); dummy.rotation.set(0, (R() - 0.5) * 0.5, 0); dummy.scale.set(s, s, s);
      dummy.updateMatrix(); im.setMatrixAt(n++, dummy.matrix);
    }
    im.count = n; im.receiveShadow = true;
    group.add(im);
  }
  group.updateMatrixWorld(true);
  return group;
}

// Pools / haze lights for the forest, registered after the lighting pass has been built.
export function forestLights(ctx) {
  const haze = [];
  const pools = [];
  // moonbeams: pale pools where the shafts land on the path and in the clearing
  const beams = [];
  for (const b of BEAMS) {
    const x = FOREST.x0 + b.lx, z = FOREST.z0 + b.lz;
    const y = forestH(b.lx, b.lz);
    const p = b.big
      ? { pos: new THREE.Vector3(x - 0.6, y + 2.6, z + 0.5), color: new THREE.Color(0.6, 0.78, 1.0), intensity: 4.6, radius: 7.5, core: 0.08, prio: 5, seed: null, weight: 9 }
      : { pos: new THREE.Vector3(x - 0.3, y + 1.7, z + 0.3), color: new THREE.Color(0.55, 0.74, 1.0), intensity: 3.0 * b.k, radius: 3.8, core: 0.15, prio: 6, seed: null, weight: b.k };
    beams.push(p);
    haze.push({ pos: new THREE.Vector3(x - 1.2, y + 3.5, z), color: new THREE.Color(0.45, 0.62, 1.0), strength: (b.big ? 0.3 : 0.16) * b.k });
  }
  const warm = [];
  LANTERNS.forEach((l, i) => {
    if (!l.main) return;
    warm.push({ pos: new THREE.Vector3(l.x, l.y, l.z + 0.1), color: new THREE.Color(1.0, 0.56, 0.22), intensity: 2.8, radius: 3.0, core: 1.3, prio: 5, seed: 3.3 + i, weight: 2 });
    if (i < 2) haze.push({ pos: new THREE.Vector3(l.x, l.y + 0.2, l.z), color: new THREE.Color(1.0, 0.6, 0.3), strength: 0.24 });
  });
  // the hoard as a whole: one broad warm key over the stump and the clearing floor
  if (LANTERNS.length) {
    const c = LANTERNS.reduce((a, l) => a.add(new THREE.Vector3(l.x, l.y, l.z)), new THREE.Vector3()).multiplyScalar(1 / LANTERNS.length);
    warm.unshift({ pos: c.clone().setY(c.y + 0.9), color: new THREE.Color(1.0, 0.55, 0.22), intensity: 4.2, radius: 5.5, core: 0.6, prio: 4, seed: 1.1, weight: 8 });
    haze.push({ pos: c.clone().setY(c.y + 0.6), color: new THREE.Color(1.0, 0.58, 0.28), strength: 0.34 });
  }
  MUSHROOMS.forEach((m, i) => {
    const p = { pos: new THREE.Vector3(m.x, m.y, m.z), color: m.col.clone(), intensity: 3.0, radius: 3.2, core: 1.4, prio: 5, seed: i * 1.7, weight: 1 };
    pools.push(p);
    if (i % 2 === 0) haze.push({ pos: p.pos.clone().setY(m.y + 0.2), color: m.col.clone(), strength: 0.2 });
  });
  // the hoard's lanterns also act as key lights for the characters' rim shading (probe reads MUSHROOMS)
  for (const l of LANTERNS) if (l.main) MUSHROOMS.push({ x: l.x, y: l.y, z: l.z, col: new THREE.Color(1.0, 0.6, 0.28) });
  for (const p of beams) ctx.pools.push(p);
  for (const p of warm) ctx.pools.push(p);
  for (const p of pools) ctx.pools.push(p);
  FX.haze = haze;
  return { haze, pools };
}

// per-frame forest upkeep (called from the fireflies' update): beam shimmer, the post pass only
// takes the first 12 haze lights so keep the ones nearest the camera first, hide Gerald's stump
// during battles (it would stand in the middle of the boss stage), and keep the other monsters
// still wandering the map out of the battle shot (they would stand behind the party).
function forestTick(t) {
  for (const m of FX.beamMats) m.uniforms.uTime.value = t;
  const cam = FX.camera;
  if (FX.haze && cam) {
    const cx = cam.position.x;
    FX.haze.sort((a, b) => Math.abs(a.pos.x - cx) - Math.abs(b.pos.x - cx));
  }
  const LK = window.LK;
  const inBattle = !!(LK && LK.mode === 'battle');
  if (FX.perch) for (const o of FX.perch) o.visible = !inBattle;
  const map = LK && LK.enemiesOnMap;
  if (map) {
    if (inBattle && !FX.hidden) {
      FX.hidden = [];
      for (const en of map) if (en.actor && en.actor.visible) { en.actor.visible = false; FX.hidden.push(en); }
    } else if (!inBattle && FX.hidden) {
      for (const en of FX.hidden) if (en.alive) en.actor.visible = true;
      FX.hidden = null;
    }
  }
}

// ---------- fireflies (forest) ----------
const FF_VS = `
attribute vec4 aSeed; attribute vec4 aColor;
uniform float uTime, uProjScale, uFocus, uRange, uAperture, uMaxCoc, uNear, uFar; uniform sampler2D tDepth; uniform vec2 uRes;
varying vec4 vColor; varying float vSoft;
float viewDepth(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
void main(){
  vec3 p = position; float t = uTime;
#ifdef FALL
  // drifting spores: sink slowly, sway, and wrap round a 5 m column
  p.y += 2.5 - mod(t * (0.12 + aSeed.x * 0.1) + aSeed.y * 5.0, 5.0);
  p.x += sin(t * 0.4 + aSeed.z * 20.0) * 0.4;
  float pulse = 1.0;
#else
  p += vec3(sin(t * 0.35 * (0.6 + aSeed.x) + aSeed.y * 30.0) * 0.7, sin(t * 0.5 * (0.6 + aSeed.z) + aSeed.w * 20.0) * 0.25, cos(t * 0.3 * (0.6 + aSeed.y) + aSeed.x * 40.0) * 0.7);
  float pulse = 0.5 + 0.5 * sin(t * (0.8 + aSeed.z * 1.2) + aSeed.w * 60.0);
#endif
  float inten = aColor.a * (0.08 + 0.92 * pulse * pulse * pulse);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float dd = depth - uFocus; float f = sign(dd) * max(abs(dd) - uRange, 0.0);
  float coc = abs(clamp(f * uAperture / depth, -uMaxCoc, uMaxCoc));
  float px = 0.05 * uProjScale / depth;
  float maxDisc = depth < uFocus - uRange ? 30.0 : 4.5;
  float disc = min(max(px, coc * 1.5) + 1.5, maxDisc);
  float k = (px + 1.5) / disc;
  vec4 clip = projectionMatrix * mv;
  vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
  float occ = 0.0;
  if (clip.w > 0.0 && all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)))) {
    float sd = viewDepth(texture2D(tDepth, suv).x);
    occ = smoothstep(0.0, 0.5, sd - depth + 0.25);
  }
  vColor = vec4(aColor.rgb * inten * occ * mix(k * k, 1.0, 0.03), 1.0);
  vSoft = clamp(coc / 6.0, 0.0, 1.0);
  gl_PointSize = occ > 0.003 && inten > 0.003 ? disc : 0.0;
  gl_Position = clip;
}`;
const FF_FS = `
varying vec4 vColor; varying float vSoft;
void main(){
  vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
  float core = exp(-r * r * 6.0);
  float bokeh = smoothstep(1.0, 0.85, r) * (0.75 + 0.35 * smoothstep(0.55, 0.95, r));
  gl_FragColor = vec4(vColor.rgb * mix(core, bokeh, vSoft), 1.0);
}`;

export function buildFireflies() {
  const R = rng(4321);
  const pos = [], seed = [], col = [];
  const n = Math.floor(120 * quality.particles) + 14;
  for (let i = 0; i < n; i++) {
    let lx, lz;
    if (i % 3 === 0) { const a = R() * Math.PI * 2, r = R() * 6; lx = FOREST.clearX + Math.cos(a) * r * 1.2; lz = FOREST.clearZ + Math.sin(a) * r * 0.8; }
    else { lx = -8 + R() * 58; lz = -12 + R() * 18; }
    pos.push(FOREST.x0 + lx, forestH(lx, lz) + 0.4 + R() * 2.0, FOREST.z0 + lz);
    seed.push(R(), R(), R(), R());
    const c = R() < 0.65 ? [0.7, 1.0, 0.3] : [0.45, 0.9, 1.0];
    col.push(c[0], c[1], c[2], 3 + R() * 5);
  }
  const mkPts = (pos, seed, col, defines) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: FF_VS, fragmentShader: FF_FS, defines,
      uniforms: {
        uTime: { value: 0 }, uProjScale: { value: 1000 }, uFocus: { value: 30 }, uRange: { value: 3 }, uAperture: { value: 60 }, uMaxCoc: { value: 24 },
        tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 800 },
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    return p;
  };
  const pts = mkPts(pos, seed, col, {});
  // pale spores drifting down through the moonlight (the forest's answer to falling snow)
  {
    const sp = [], ss = [], sc = [];
    const m = Math.floor(420 * quality.particles) + 40;
    for (let i = 0; i < m; i++) {
      const lx = -10 + R() * 70, lz = -14 + R() * 26;
      sp.push(FOREST.x0 + lx, Math.max(0, forestH(lx, lz)) + 0.5 + R() * 2.5, FOREST.z0 + lz);
      ss.push(R(), R(), R(), R());
      sc.push(0.62, 0.78, 1.0, 0.5 + R() * 1.1);
    }
    pts.add(mkPts(sp, ss, sc, { FALL: 1 }));
  }
  const mats = [pts.material, pts.children[0].material];
  return {
    pts,
    update(t) { for (const m of mats) m.uniforms.uTime.value = t; forestTick(t); },
    setPostUniforms(post, camera) {
      FX.camera = camera;
      for (const mat of mats) {
        const U = mat.uniforms;
        U.tDepth.value = post.rtScene.depthTexture;
        U.uRes.value.set(post.w, post.h);
        U.uNear.value = camera.near; U.uFar.value = camera.far;
        U.uProjScale.value = post.h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        for (const k of ['uFocus', 'uRange', 'uAperture', 'uMaxCoc']) U[k].value = post.common[k].value;
      }
    },
  };
}
