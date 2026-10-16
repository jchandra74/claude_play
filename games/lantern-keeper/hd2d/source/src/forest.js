// The Whisperwood: the forest east of Wickhollow, built in the same HD-2D style as the plaza.
// It lives in the same scene, offset far to the east (FOREST.x0) so the plaza and the forest share
// one renderer, one lighting system and one post pipeline; the game moves the sky and moonlight
// with the active area. Layout (local metres, +z toward the camera): a winding dirt path runs west
// to east along z ~ 0 between stepped mossy rock ledges at the back and a lower, blurred foreground
// tier; it opens into a clearing with a crooked broken lamp where Gerald roosts.
import * as THREE from 'three';
import { tileTex, makeSprite } from './assets.js';
import { pxName, blobShadow } from './props.js';
import { rng, noise2 } from './layout.js';
import { quality } from './config.js';
import { frame } from './game_tex.js';

export const FOREST = { x0: 600, z0: 0, entryX: -1.5, clearX: 40, clearZ: -1.2, clearR: 6.2, x1: 47 };

// path centre line (local)
export function pathZ(lx) { return 0.7 * Math.sin(lx * 0.16) + 0.35 * Math.sin(lx * 0.41 + 1.3); }

const smooth = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
function ledge1(lx) {
  let z = -5.0 + 0.8 * Math.sin(lx * 0.21) + 0.5 * Math.sin(lx * 0.53 + 1);
  const dc = Math.abs(lx - FOREST.clearX);
  if (dc < 10) z -= 3.2 * smooth(10, 4, dc);         // the clearing pushes the ledge back
  return z;
}
const ledge2 = (lx) => -12 + 1.5 * Math.sin(lx * 0.13 + 2) + 0.6 * Math.sin(lx * 0.37);
const ledge3 = (lx) => -20 + 2 * Math.sin(lx * 0.1 + 0.4);
const front = (lx) => 5.2 + 0.6 * Math.sin(lx * 0.3) + 0.4 * Math.sin(lx * 0.71 + 2);

// local height
export function forestH(lx, lz) {
  let h = 0;
  h += 1.25 * smooth(0, 0.45, ledge1(lx) - lz);
  h += 1.5 * smooth(0, 0.5, ledge2(lx) - lz);
  h += 2.2 * smooth(0, 0.8, ledge3(lx) - lz);
  h += 4 * smooth(0, 14, ledge3(lx) - 2 - lz);
  h -= 1.3 * smooth(0, 0.45, lz - front(lx));
  // the forest closes in beyond the clearing and at the west entrance edges
  h += 2.5 * smooth(0, 1.2, lx - 50) + 2.0 * smooth(0, 1, -12 - lx);
  // gentle floor undulation (keeps the path level)
  h += (noise2(lx * 0.35, lz * 0.35) - 0.5) * 0.12 * smooth(1, 3, Math.abs(lz - pathZ(lx)));
  return h;
}
// world-space ground height (for actors / collision)
export function forestGround(x, z) { return forestH(x - FOREST.x0, z - FOREST.z0); }

export const FOREST_COLLIDERS = [];   // { x, z, r } in world coords
export const MUSHROOMS = [];         // { x, y, z, col }

function groundMesh() {
  const X0 = -16, X1 = 64, Z0 = -40, Z1 = 16, S = quality.name === 'low' ? 0.5 : 0.4;
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
    const cd = Math.hypot((x - FOREST.clearX) / 1.25, z - FOREST.clearZ) - FOREST.clearR * 0.72;
    let dirt = Math.max(smooth(0.6, -0.2, pd), smooth(0.8, -0.6, cd) * 0.85);
    if (x < -4) dirt *= smooth(-9, -4, x);
    dirt = Math.max(dirt, noise2(x * 0.4 + 20, z * 0.4) > 0.78 ? 0.55 : 0);
    const rock = smooth(0.82, 0.55, n.getY(i));
    mix[i * 2] = dirt; mix[i * 2 + 1] = rock;
    // contact AO at the foot of each ledge, and a darker, mossier floor away from the path
    let hi = 0;
    for (const [dx, dz] of [[0, -0.8], [0, -1.6], [0.8, -0.8], [-0.8, -0.8]]) hi = Math.max(hi, forestH(x + dx, z + dz) - y);
    const ao = 1 - 0.5 * smooth(0.2, 1.1, hi);
    const shade = 0.82 + 0.18 * nn;
    col[i * 3] = ao * shade * 0.92; col[i * 3 + 1] = ao * shade; col[i * 3 + 2] = ao * shade * 0.95;
  }
  geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ map: tileTex('tex_grass'), roughness: 1, metalness: 0, vertexColors: true });
  const tDirt = tileTex('tex_dirt'), tRock = tileTex('tex_cliff');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDirt = { value: tDirt }; sh.uniforms.tRock = { value: tRock };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMix; varying vec2 vMix; varying vec3 vFP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMix = aMix; vFP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDirt, tRock; varying vec2 vMix; varying vec3 vFP;')
      .replace('#include <map_fragment>', `{
        vec2 uv = vFP.xz / 2.0;
        vec4 g = texture2D(map, uv);
        vec4 g2 = texture2D(map, uv * 0.37 + 0.31);
        g = mix(g, g2, 0.35);
        vec4 d = texture2D(tDirt, uv);
        vec4 r = texture2D(tRock, vec2(vFP.x + vFP.z * 0.35, vFP.y * 1.3) / 2.4);
        vec4 c = mix(g * vec4(0.86, 1.0, 0.9, 1.0), d, vMix.x);
        c = mix(c, r * vec4(0.95, 1.0, 1.05, 1.0), vMix.y);
        diffuseColor *= c;
      }`);
  };
  mat.customProgramCacheKey = () => 'forest-ground';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// small pixel grass tufts (instanced), same construction as the plaza's
function tuftTex(variant) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const R = rng(5000 + variant * 31);
  const shades = [['#2f5a34', '#3f7040', '#558a48', '#76a456'], ['#2c5236', '#3a6640', '#4f8048', '#6e9a52']][variant % 2];
  for (let b = 0; b < 11; b++) {
    const x = 2 + Math.floor(R() * 12), hh = 5 + Math.floor(R() * 10), lean = R() < 0.5 ? -1 : 1;
    for (let k = 0; k < hh; k++) { g.fillStyle = shades[Math.min(3, Math.floor(k / hh * 4))]; g.fillRect(x + (k > hh * 0.6 ? lean : 0), 15 - k, 1, 1); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

// a sprite made from a registered procedural frame
function procSprite(key, h, opts = {}) {
  const f = frame(key);
  const w = h * f.w / f.h;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2, 0);
  const nrm = geo.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 0.86, 0.51);
  if (opts.flip) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
  const m = new THREE.MeshStandardMaterial({ map: f.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  if (f.emis && opts.emissive) { m.emissiveMap = f.emis; m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = opts.emissive; }
  const s = new THREE.Mesh(geo, m);
  s.castShadow = opts.castShadow ?? true; s.receiveShadow = true;
  s.userData.size = [w, h];
  return s;
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

export function buildForest(ctx) {
  const X = FOREST.x0, Z = FOREST.z0;
  const group = new THREE.Group();
  group.position.set(X, 0, Z);
  ctx.scene.add(group);
  ctx.forestGroup = group;
  group.add(groundMesh());
  const R = rng(777);
  const W = (lx, lz) => [X + lx, Z + lz];
  const on = (lx, lz) => forestH(lx, lz);
  const put = (obj, lx, lz, dy = 0) => { obj.position.set(lx, on(lx, lz) + dy, lz); group.add(obj); return obj; };
  const tree = (lx, lz, h, pine, flip) => {
    const s = makeSprite(pxName(pine ? 'pine' : 'oak', h), { h, yaw: 0, flip, selfLight: 0.025 });
    put(s, lx, lz);
    const [w] = s.userData.size;
    group.add(blobShadow(lx, on(lx, lz), lz, w * 0.28, w * 0.18, 0.55));
    const [wx, wz] = W(lx, lz);
    FOREST_COLLIDERS.push({ x: wx, z: wz, r: pine ? 0.45 : 0.55 });
    return s;
  };
  const nearPath = (lx, lz, m) => Math.abs(lz - pathZ(lx)) < m || Math.hypot((lx - FOREST.clearX) / 1.2, lz - FOREST.clearZ) < FOREST.clearR + m - 1.5;

  // --- the back wall of forest: dense pines and oaks climbing the ledges, several depth layers ---
  const dens = quality.name === 'low' ? 0.7 : 1;
  for (let i = 0; i < 520 * dens; i++) {
    const lx = -14 + R() * 76, lz = -36 + R() * 33;
    if (lz > ledge1(lx) - 0.6) continue;
    const back = lz < ledge2(lx);
    if (!back && R() < 0.45) continue;
    if (Math.abs(lx - FOREST.clearX) < 5 && lz > ledge2(lx)) continue;   // keep the clearing's back open a little
    const pine = R() < 0.72;
    const h = (pine ? 6 + R() * 3.5 : 5 + R() * 2) * (back ? 1.1 : 1);
    tree(lx, lz, h, pine, R() < 0.5);
  }
  // --- trees along the floor, either side of the path ---
  for (let i = 0; i < 260; i++) {
    const lx = -12 + R() * 64, lz = -6 + R() * 11;
    if (on(lx, lz) > 0.5 || on(lx, lz) < -0.3) continue;
    if (nearPath(lx, lz, 2.6)) continue;
    if (lz > pathZ(lx) && (lz < pathZ(lx) + 3.6 || R() < 0.6)) continue;   // keep the near side of the path open
    if (FOREST_COLLIDERS.some(c => Math.hypot(c.x - X - lx, c.z - Z - lz) < 2.2)) continue;
    tree(lx, lz, R() < 0.6 ? 5.5 + R() * 2.5 : 4.6 + R() * 1.5, R() < 0.6, R() < 0.5);
  }
  // --- big blurred foreground trunks on the lower front tier (frame the shot) ---
  for (let lx = -10; lx < 58; lx += 6 + R() * 6) {
    const lz = front(lx) + 2.5 + R() * 4;
    const s = makeSprite(pxName(R() < 0.5 ? 'pine' : 'oak', 8), { h: 7.5 + R() * 3, yaw: 0, flip: R() < 0.5, selfLight: 0.02 });
    put(s, lx, lz);
  }
  // --- west entrance: an arch of trees either side of the road ---
  for (const [lx, lz, h, p] of [[-4.5, -2.6, 7.2, true], [-5.2, 2.6, 6.6, false], [-8.5, -1.8, 7.8, true], [-9.0, 3.0, 7.0, true], [-3.0, 3.6, 5.6, false]]) tree(lx, lz, h, p, R() < 0.5);
  // --- the clearing's rim of trees ---
  for (let a = -0.2; a < Math.PI + 0.3; a += 0.42) {
    const lx = FOREST.clearX + Math.cos(a) * 8.4, lz = FOREST.clearZ - Math.sin(a) * 6.6;
    if (on(lx, lz) > 1.6) continue;
    tree(lx, lz, 6 + R() * 2.5, R() < 0.6, R() < 0.5);
  }
  for (const [lx, lz] of [[49, 1.5], [48.5, -3], [47.5, 4]]) tree(lx, lz, 6.5 + R() * 2, true, R() < 0.5);

  // --- bushes, flowers, rocks, stumps along the path edges ---
  for (let i = 0; i < 140; i++) {
    const lx = -10 + R() * 60, lz = -6 + R() * 12;
    const hgt = on(lx, lz);
    if (hgt > 1.4 || hgt < -0.2 || nearPath(lx, lz, 1.9)) continue;
    const k = R();
    if (k < 0.45) { const h = 0.6 + R() * 0.6; put(makeSprite(pxName('bush', h), { h, yaw: 0, flip: R() < 0.5, selfLight: 0.03 }), lx, lz); group.add(blobShadow(lx, hgt, lz, h * 0.6, h * 0.35, 0.45)); }
    else if (k < 0.75) put(makeSprite(pxName('flowers', 0.45), { h: 0.42 + R() * 0.12, yaw: 0, flip: R() < 0.5, selfLight: 0.05, castShadow: false }), lx, lz);
    else if (k < 0.9) {
      const h = 0.45 + R() * 0.35, s = procSprite('rock_' + (i % 4), h, { flip: R() < 0.5 });
      put(s, lx, lz); group.add(blobShadow(lx, hgt, lz, h * 0.8, h * 0.4, 0.6));
      const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: h * 0.8 });
    } else {
      const s = procSprite('stump', 0.5, { flip: R() < 0.5 });
      put(s, lx, lz); group.add(blobShadow(lx, hgt, lz, 0.45, 0.25, 0.6));
      const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: 0.42 });
    }
  }
  // rocks sitting at the foot of the ledges
  for (let i = 0; i < 40; i++) {
    const lx = -10 + R() * 60, lz = ledge1(lx) + 0.4 + R() * 0.4;
    if (nearPath(lx, lz, 1.6)) continue;
    const h = 0.5 + R() * 0.5;
    put(procSprite('rock_' + (i % 4), h, { flip: R() < 0.5 }), lx, lz);
  }

  // --- glowing mushrooms: clusters along the path and a ring round the clearing ---
  const mush = (lx, lz, pool) => {
    const k = Math.floor(R() * 6), f = frame('mush_' + k);
    const s = procSprite('mush_' + k, 0.32 + R() * 0.14, { emissive: 2.2, castShadow: false, flip: R() < 0.5 });
    put(s, lx, lz);
    const c = new THREE.Color(f.col[0] / 255, f.col[1] / 255, f.col[2] / 255);
    const [wx, wz] = W(lx, lz);
    if (pool) MUSHROOMS.push({ x: wx, y: on(lx, lz) + 0.35, z: wz, col: c });
  };
  for (let lx = 0; lx < 36; lx += 2.6 + R() * 2.4) {
    const side = R() < 0.5 ? -1 : 1;
    const lz = pathZ(lx) + side * (1.8 + R() * 1.2);
    if (on(lx, lz) > 0.4) continue;
    mush(lx, lz, true);
    if (R() < 0.6) mush(lx + 0.35, lz + 0.25, false);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.55) {
    const lx = FOREST.clearX + Math.cos(a) * (4.4 + R() * 1.2), lz = FOREST.clearZ + Math.sin(a) * (3.6 + R() * 0.8);
    if (on(lx, lz) > 0.4) continue;
    mush(lx, lz, a % 1.1 < 0.6);
  }

  // --- the broken old lamp where Gerald roosts ---
  {
    const lx = FOREST.clearX + 1.6, lz = FOREST.clearZ - 1.6;
    put(procSprite('oldlamp', 2.0, {}), lx, lz);
    group.add(blobShadow(lx, on(lx, lz), lz, 0.5, 0.3, 0.7));
    const [wx, wz] = W(lx, lz); FOREST_COLLIDERS.push({ x: wx, z: wz, r: 0.4 });
    FOREST.lamp = { x: wx, z: wz };
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

  // --- grass tufts ---
  const per = Math.floor(quality.tufts * 0.35);
  const dummy = new THREE.Object3D();
  for (let v = 0; v < 2; v++) {
    const geo = new THREE.PlaneGeometry(0.38, 0.38); geo.translate(0, 0.19, 0);
    const nn = geo.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: tuftTex(v), alphaTest: 0.5, roughness: 1 }), per);
    let n = 0;
    for (let i = 0; i < per * 6 && n < per; i++) {
      const lx = -12 + R() * 68, lz = -14 + R() * 24;
      if (nearPath(lx, lz, 1.3) && R() < 0.9) continue;
      const s = 0.7 + R() * 0.8;
      dummy.position.set(lx, on(lx, lz), lz); dummy.rotation.set(0, (R() - 0.5) * 0.5, 0); dummy.scale.set(s, s, s);
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
  MUSHROOMS.forEach((m, i) => {
    const p = { pos: new THREE.Vector3(m.x, m.y, m.z), color: m.col.clone(), intensity: 2.6, radius: 2.8, core: 1.6, prio: 5, seed: i * 1.7, weight: 1 };
    pools.push(p);
    if (i % 2 === 0) haze.push({ pos: p.pos.clone().setY(m.y + 0.2), color: m.col.clone(), strength: 0.22 });
  });
  // moonbeams: pale shafts falling through gaps in the canopy onto the path and the clearing
  const beams = [];
  for (let lx = 4; lx < 46; lx += 9) {
    const x = FOREST.x0 + lx, z = FOREST.z0 + pathZ(lx) - 0.6;
    const p = { pos: new THREE.Vector3(x, 5.5, z), color: new THREE.Color(0.55, 0.72, 1.0), intensity: 1.7, radius: 7.5, core: 0.12, prio: 6, seed: null, weight: 1 };
    beams.push(p);
    haze.push({ pos: new THREE.Vector3(x, 3.2, z - 0.5), color: new THREE.Color(0.45, 0.62, 1.0), strength: 0.16 });
  }
  for (const p of beams) ctx.pools.push(p);
  for (const p of pools) ctx.pools.push(p);
  return { haze, pools };
}

// ---------- fireflies (forest) ----------
const FF_VS = `
attribute vec4 aSeed; attribute vec4 aColor;
uniform float uTime, uProjScale, uFocus, uRange, uAperture, uMaxCoc, uNear, uFar; uniform sampler2D tDepth; uniform vec2 uRes;
varying vec4 vColor; varying float vSoft;
float viewDepth(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
void main(){
  vec3 p = position; float t = uTime;
  p += vec3(sin(t * 0.35 * (0.6 + aSeed.x) + aSeed.y * 30.0) * 0.7, sin(t * 0.5 * (0.6 + aSeed.z) + aSeed.w * 20.0) * 0.25, cos(t * 0.3 * (0.6 + aSeed.y) + aSeed.x * 40.0) * 0.7);
  float pulse = 0.5 + 0.5 * sin(t * (0.8 + aSeed.z * 1.2) + aSeed.w * 60.0);
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
  const n = Math.floor(70 * quality.particles) + 10;
  for (let i = 0; i < n; i++) {
    const lx = -8 + R() * 58, lz = -9 + R() * 15;
    pos.push(FOREST.x0 + lx, forestH(lx, lz) + 0.4 + R() * 1.6, FOREST.z0 + lz);
    seed.push(R(), R(), R(), R());
    const c = R() < 0.65 ? [0.7, 1.0, 0.3] : [0.45, 0.9, 1.0];
    col.push(c[0], c[1], c[2], 3 + R() * 5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: FF_VS, fragmentShader: FF_FS,
    uniforms: {
      uTime: { value: 0 }, uProjScale: { value: 1000 }, uFocus: { value: 30 }, uRange: { value: 3 }, uAperture: { value: 60 }, uMaxCoc: { value: 24 },
      tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 800 },
    },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    pts,
    update(t) { mat.uniforms.uTime.value = t; },
    setPostUniforms(post, camera) {
      const U = mat.uniforms;
      U.tDepth.value = post.rtScene.depthTexture;
      U.uRes.value.set(post.w, post.h);
      U.uNear.value = camera.near; U.uFar.value = camera.far;
      U.uProjScale.value = post.h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      for (const k of ['uFocus', 'uRange', 'uAperture', 'uMaxCoc']) U[k].value = post.common[k].value;
    },
  };
}
