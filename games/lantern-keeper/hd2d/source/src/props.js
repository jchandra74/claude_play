// Props & foliage: Great Lantern on its dais, street lamps, well, barrels, crates, trees, fences,
// scattered bushes / flowers / pixel grass tufts, background pine forest, and blob contact shadows.
import * as THREE from 'three';
import { PROPS, FENCES, HOUSES, rng, noise2, plazaDist, groundAt, TIER } from './layout.js';
import { makeSprite, tileTex, spriteTex, size as imgSize } from './assets.js';
import { groundY, levelAtCell, isNearCliffTop, isNearCliffBase } from './terrain.js';
import { worldUV } from './geom.js';
import { quality } from './config.js';

// ---- one shared pixel grid ----
// Every sprite exists as a ladder of pre-scaled variants (assets/pxgrid.py -> native/px_<name>_<H>.png);
// pick the rung whose texel density is closest to PX_PER_M (the ground textures' density).
export const PX_PER_M = 56;
const ASSET_KEYS = Object.keys(window.__ASSETS || {});
const rungCache = new Map();
export function pxName(name, h) {
  if (!rungCache.has(name)) {
    const re = new RegExp('^px_' + name + '_(\\d+)$');
    rungCache.set(name, ASSET_KEYS.map(k => k.match(re)).filter(Boolean).map(m => +m[1]));
  }
  const rungs = rungCache.get(name);
  if (!rungs.length) return name;
  const want = h * PX_PER_M;
  let best = rungs[0];
  for (const r of rungs) if (Math.abs(Math.log(r / want)) < Math.abs(Math.log(best / want))) best = r;
  return 'px_' + name + '_' + best;
}

// ---- grounded contact shadow: a small, dense, pixel-stepped ellipse (no soft smudge) ----
let contactTex = null;
function contactTexture() {
  if (contactTex) return contactTex;
  const W = 24, H = 24, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), d = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
    const r = Math.sqrt(dx * dx + dy * dy);
    const a = r < 0.55 ? 1 : r < 0.8 ? 0.62 : r < 1 ? ((x + y) % 2 ? 0.3 : 0.12) : 0;
    d.data.set([255, 255, 255, Math.round(a * 255)], (y * W + x) * 4);
  }
  g.putImageData(d, 0, 0);
  contactTex = new THREE.CanvasTexture(c);
  contactTex.magFilter = contactTex.minFilter = THREE.NearestFilter; contactTex.generateMipmaps = false;
  return contactTex;
}
let solidTex = null;
function solidTexture() {
  if (solidTex) return solidTex;
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 2, 2);
  solidTex = new THREE.CanvasTexture(c);
  return solidTex;
}
// Shadow decals multiply the lit scene (the scene buffer is HDR, so alpha-blended black barely
// darkens bright lantern-lit cobbles); fragment colour = 1 - coverage * opacity.
export function shadowMaterial(map, opacity, flipU = false, fadeV = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float uOpacity, uFlip, uFade; varying vec2 vUv;
      void main(){
        vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlip), vUv.y);
        float a = texture2D(map, uv).a;
        if (a < 0.02) discard;
        float k = a * uOpacity * (1.0 - uFade * smoothstep(0.0, 1.0, vUv.y));
        gl_FragColor = vec4(vec3(1.0 - k), 1.0);
      }`,
    uniforms: { map: { value: map }, uOpacity: { value: opacity }, uFlip: { value: flipU ? 1 : 0 }, uFade: { value: fadeV } },
    transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}
const contactMats = new Map();
export function blobShadow(x, y, z, rx, rz, opacity = 0.6) {
  const key = Math.round(opacity * 20);
  if (!contactMats.has(key)) contactMats.set(key, shadowMaterial(contactTexture(), key / 20));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2), contactMats.get(key));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.02, z);
  m.renderOrder = 2;
  return m;
}

function insideHouse(x, z, pad = 0.6) {
  for (const h of HOUSES) {
    const dx = x - h.x, dz = z - h.z;
    const c = Math.cos(-h.rot), s = Math.sin(-h.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < h.w / 2 + pad && Math.abs(lz) < h.d / 2 + pad) return true;
  }
  return false;
}

const SPRITE_OPTS = {
  great_lantern: { unlit: new THREE.Color(1.25, 1.06, 0.86), emissive: true, emissiveIntensity: 5.5, emissiveOpts: { threshold: 0.5, warm: 0.15, region: [0.1, 0.48] }, selfLight: 0.12 },
  lamp: { unlit: 0xb09a86, emissive: true, emissiveIntensity: 4.5, emissiveOpts: { threshold: 0.5, warm: 0.12, region: [0, 0.3] }, selfLight: 0.06 },
  oak: { selfLight: 0.03 },
  pine: { selfLight: 0.03 },
};

function placeSprite(group, type, x, z, h, yaw, extra = {}) {
  const y = extra.y ?? groundY(x, z);
  const name = extra.native ? type : pxName(type, h);
  const s = makeSprite(name, { h, yaw, ...(SPRITE_OPTS[type] || {}), ...extra });
  s.position.set(x, y, z);
  group.add(s);
  return s;
}

// ---- generated pixel-art grass tufts ----
function tuftTexture(variant) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const R = rng(1000 + variant * 77);
  const shades = [['#355f30', '#46793a', '#5d9042', '#7fa651'], ['#325a33', '#41703c', '#558a42', '#76a04e'], ['#3c6236', '#4f773e', '#6a8c46', '#93a85a']][variant % 3];
  const blades = 9 + Math.floor(R() * 5);
  for (let b = 0; b < blades; b++) {
    const x = 2 + Math.floor(R() * 12), hh = 5 + Math.floor(R() * 10);
    const lean = R() < 0.5 ? -1 : 1;
    for (let k = 0; k < hh; k++) {
      const yy = 15 - k;
      const xx = x + (k > hh * 0.6 ? lean : 0);
      g.fillStyle = shades[Math.min(3, Math.floor(k / hh * 4))];
      g.fillRect(xx, yy, 1, 1);
    }
  }
  if (variant === 3) {
    const cols = ['#e8e4ff', '#9ec4ff', '#ffd6e8', '#fff2a8'];
    for (let f = 0; f < 4; f++) { g.fillStyle = cols[Math.floor(R() * 4)]; const fx = 2 + Math.floor(R() * 12), fy = 3 + Math.floor(R() * 6); g.fillRect(fx, fy, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

function tuftGeometry(w, h) {
  const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
  const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

// ---- volumetric oak: trunk sprite (canopy masked out) + instanced leaf-clump cards on a lumpy
// ellipsoid. Each card carries its own ellipsoid normal so the lantern / moon light the canopy
// like a 3D crown (bright rim toward the light, dark undersides), and every card sits on the same
// PX_PER_M pixel grid as the rest of the scene.
const CLUMP_VARIANTS = 6;
// Canopy shading is sculpted per clump on the CPU (instance colour = light reaching that clump: a cool
// moon key from the upper left in three hard bands, a warm rim from the Great Lantern side, a cool
// sky fill and crown occlusion) and then pushed through the clump texture's own baked top-left
// lighting. aHi lifts the texture's brightest leaf pixels on lit clumps into highlight clusters.
// The scene lights (pools from lamps, moon) still add a little on top.
function clumpMaterial(v) {
  const map = spriteTex('px_leafclump_' + v);
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aNrm; attribute float aHi; varying float vHi;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aNrm; vHi = aHi;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHi;')
      .replace('#include <opaque_fragment>', `{
        vec3 tx = texture2D(map, vMapUv).rgb;
        float lum = dot(tx, vec3(0.3, 0.6, 0.1));
        float hiMask = smoothstep(0.16, 0.42, lum);
        vec3 lit = diffuseColor.rgb * (1.0 + vHi * hiMask * 1.1);
        // highlight clusters pick up a pale moon-gold sheen rather than just brighter green
        lit += vHi * hiMask * vec3(0.035, 0.05, 0.05);
        // night: keep the crown's greens muted (no lime) so the lantern stays the warmest, most saturated thing
        lit = mix(vec3(dot(lit, vec3(0.3, 0.59, 0.11))), lit, 0.78) * 0.9;
        outgoingLight = lit + outgoingLight * 0.35 + vec3(0.002, 0.005, 0.008);
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'leafclump2';
  return m;
}

const KEY_DIR = new THREE.Vector3(-0.6, 0.75, 0.3).normalize();
const KEY_COL = new THREE.Color(0.42, 0.56, 0.72);
const FILL_COL = new THREE.Color(0.07, 0.12, 0.17);
const RIM_COL = new THREE.Color(1.0, 0.56, 0.22);
function buildOaks(group, oaks, ctx, R) {
  const yaw = ctx.yaw;
  const camDir = new THREE.Vector3(Math.sin(yaw), 0.55, Math.cos(yaw)).normalize();
  const per = Array.from({ length: CLUMP_VARIANTS }, () => ({ mats: [], nrm: [], col: [], hi: [] }));
  const [cw, chh] = imgSize('px_leafclump_0');
  const cardW = cw / PX_PER_M, cardH = chh / PX_PER_M;
  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3(), nW = new THREE.Vector3(), nWorld = new THREE.Vector3(), toLan = new THREE.Vector3();
  const lowQ = quality.name === 'low';
  const LAN = PROPS.find(p => p.type === 'great_lantern');
  for (const p of oaks) {
    const y0 = groundY(p.x, p.z);
    const trunk = makeSprite(pxName('oaktrunk', p.h), { h: p.h, yaw, flip: p.flip, selfLight: 0.16 });
    trunk.position.set(p.x, y0, p.z);
    group.add(trunk);
    const tw = trunk.userData.size[0];
    group.add(blobShadow(p.x, y0, p.z, tw * 0.4, tw * 0.26, 0.7));
    // canopy ellipsoid (in sprite-local terms: centre ~64% up, spanning the sprite width)
    const rx = tw * 0.44, ry = p.h * 0.27, rz = tw * 0.36;
    const cy = y0 + p.h * 0.62;
    // warm rim from the lantern side, fading with distance
    toLan.set(LAN.x - p.x, 1.2, LAN.z - p.z);
    const lanDist = Math.hypot(LAN.x - p.x, LAN.z - p.z);
    toLan.normalize();
    const rimK = Math.min(0.85, Math.max(0.22, 6.5 / lanDist));
    // lumpy crown: a few big lobes, like the clustered oak in Octopath's towns
    const lobes = [];
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, e = (R() - 0.25) * 1.2;
      lobes.push(new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)));
    }
    const k = 1.6, area = 4 * Math.PI * Math.pow((Math.pow(rx * ry, k) + Math.pow(rx * rz, k) + Math.pow(ry * rz, k)) / 3, 1 / k);
    const n = Math.round(Math.min(300, area / (cardW * cardH) * 2.3) * (lowQ ? 0.6 : 1));
    const c = Math.cos(-yaw), sn = Math.sin(-yaw);
    for (let i = 0; i < n; i++) {
      // direction biased to the upper / camera-facing half; underside kept sparse so the trunk reads
      let d;
      do { d = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1); } while (d.lengthSq() > 1 || d.lengthSq() < 0.05);
      d.normalize();
      if (d.y < -0.6 && R() < 0.6) { i--; continue; }
      let lobe = 0; for (const L of lobes) lobe = Math.max(lobe, Math.pow(Math.max(0, d.dot(L)), 4));
      const pick = R();
      // inner shell (depth), main shell, and a fringe of smaller clumps that breaks the silhouette
      const fringe = pick > 0.8;
      const shell = pick < 0.16 ? 0.45 + 0.25 * R() : fringe ? 1.0 + 0.12 * R() : 0.72 + 0.28 * Math.sqrt(R());
      const r = shell * (0.86 + 0.24 * lobe);
      const lx = d.x * rx * r, ly = d.y * ry * r, lz = d.z * rz * r;
      // flipped sprite -> mirror crown
      const wx = p.x + (p.flip ? -1 : 1) * (lx * Math.cos(yaw) + lz * Math.sin(yaw));
      const wz = p.z + (-lx * Math.sin(yaw) + lz * Math.cos(yaw));
      dummy.position.set(wx, cy + ly, wz);
      dummy.rotation.set(0, yaw, (R() - 0.5) * 0.7);
      dummy.scale.setScalar(fringe ? 0.5 + 0.25 * R() : 0.9 + 0.2 * R());
      dummy.updateMatrix();
      // world-space ellipsoid normal
      nW.set(d.x / rx, d.y / ry, d.z / rz).normalize();
      nWorld.set(nW.x * Math.cos(yaw) + nW.z * Math.sin(yaw), nW.y, -nW.x * Math.sin(yaw) + nW.z * Math.cos(yaw));
      if (p.flip) nWorld.x *= -1;
      // shading normal handed to the scene lights: leaning to camera & sky
      tmp.copy(nWorld).multiplyScalar(0.75).addScaledVector(camDir, 0.45).normalize();
      const nx = tmp.x * c - tmp.z * sn, nz = tmp.x * sn + tmp.z * c;
      // occlusion: inner shell and underside darker
      const ao = (0.45 + 0.55 * Math.min(1, Math.max(0, shell - 0.6) / 0.4)) * (0.55 + 0.45 * (0.5 + 0.5 * d.y));
      // moon key in hard bands (sculpted, not gradient)
      const kd = nWorld.dot(KEY_DIR) + (R() - 0.5) * 0.12;
      const band = kd > 0.5 ? 1.0 : kd > 0.15 ? 0.6 : kd > -0.25 ? 0.3 : 0.12;
      const rim = Math.pow(Math.max(0, nWorld.dot(toLan)), 2.2) * rimK * (shell > 0.8 ? 1 : 0.4);
      const hue = 0.94 + R() * 0.12;
      const col = [0, 1, 2].map(j => {
        const kc = [KEY_COL.r, KEY_COL.g, KEY_COL.b][j], fc = [FILL_COL.r, FILL_COL.g, FILL_COL.b][j], rc = [RIM_COL.r, RIM_COL.g, RIM_COL.b][j];
        return ao * (fc + kc * band * 0.95) + rc * rim * 1.1;
      });
      col[0] *= hue;
      const v = Math.floor(R() * CLUMP_VARIANTS);
      per[v].mats.push(dummy.matrix.clone());
      per[v].nrm.push(nx, tmp.y, nz);
      per[v].col.push(...col);
      per[v].hi.push((band >= 1 ? 1 : band >= 0.6 ? 0.35 : 0) * ao + rim * 0.8);
    }
  }
  const geo0 = new THREE.PlaneGeometry(cardW, cardH);
  for (let v = 0; v < CLUMP_VARIANTS; v++) {
    const P = per[v];
    if (!P.mats.length) continue;
    const geo = geo0.clone();
    const im = new THREE.InstancedMesh(geo, clumpMaterial(v), P.mats.length);
    geo.setAttribute('aNrm', new THREE.InstancedBufferAttribute(new Float32Array(P.nrm), 3));
    geo.setAttribute('aHi', new THREE.InstancedBufferAttribute(new Float32Array(P.hi), 1));
    P.mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(P.col[i * 3], P.col[i * 3 + 1], P.col[i * 3 + 2])); });
    im.castShadow = true; im.receiveShadow = true;
    const map = spriteTex('px_leafclump_' + v);
    im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
    im.customDistanceMaterial = new THREE.MeshDistanceMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
    im.frustumCulled = false;
    group.add(im);
  }
}

// ---- Great Lantern dais: carved octagonal stone steps ----
// Risers carry their own pixel-art block texture (worn lip, mortar joints, dark foot) and are lit by a
// fake lantern bounce: the riser faces point away from the lantern, so physically they would be black;
// in HD-2D they read as warm stone catching the glow of the pool in front of them.
const DAIS_STEPS = [{ r: 2.6, top: 0.2, bot: -0.02 }, { r: 2.05, top: 0.4, bot: 0.18 }];
const RISER_TEX_W = 160, RISER_TEX_H = 12;           // 56 px/m: 2.86 m x 0.21 m
function riserTexture() {
  const W = RISER_TEX_W, H = RISER_TEX_H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), d = g.createImageData(W, H), R = rng(717);
  const put = (x, y, rgb) => d.data.set([rgb[0], rgb[1], rgb[2], 255], ((y * W) + ((x % W) + W) % W) * 4);
  const shade = (rgb, k) => rgb.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
  const base = [138, 118, 96];
  // block layout: one course of dressed blocks under a capstone lip
  let x = 0;
  const joints = [];
  while (x < W) { joints.push(x); x += 17 + Math.floor(R() * 16); }
  if (W - joints[joints.length - 1] < 8) joints.pop();
  joints.push(W);
  for (let b = 0; b < joints.length - 1; b++) {
    const x0 = joints[b], x1 = joints[b + 1], tone = 0.82 + R() * 0.3, warm = R() < 0.3;
    const col = warm ? [base[0] * 1.06, base[1], base[2] * 0.9] : base;
    for (let xx = x0; xx < x1; xx++) for (let y = 3; y < H; y++) {
      let k = tone * (0.93 + R() * 0.12);
      if (xx === x0) k = 0.42;                          // mortar joint
      else if (xx === x0 + 1 || y === 3) k *= 1.22;     // lit upper-left bevel of each block
      else if (xx === x1 - 1 || y === H - 2) k *= 0.74; // shadowed lower-right bevel
      if (y === H - 1) k = 0.36;                         // foot of the riser: contact darkness
      if (R() < 0.05) k *= 0.8;                           // pits
      put(xx, y, shade(col, k));
    }
  }
  // capstone lip: bright worn top edge, a mid band and a dark shadow line beneath the overhang
  for (let xx = 0; xx < W; xx++) {
    const n = 0.95 + R() * 0.1;
    put(xx, 0, shade([214, 186, 142], n * (R() < 0.08 ? 0.86 : 1)));
    put(xx, 1, shade([168, 146, 114], n));
    put(xx, 2, shade([70, 60, 52], n));
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function octPt(cx, cz, r, k) { const a = (k + 0.5) * Math.PI / 4; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; }

function buildDais(group, lantern) {
  const cx = lantern.x, cz = lantern.z;
  const stone = tileTex('tex_stonebrick');
  const daisMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9, color: 0xcbbfb2, vertexColors: true });
  const riserMat = new THREE.MeshStandardMaterial({ map: riserTexture(), roughness: 0.95, color: 0xffffff });
  riserMat.onBeforeCompile = (sh) => {
    sh.uniforms.uLan = { value: new THREE.Vector3(cx, 0, cz) };
    sh.uniforms.uWarm = { value: new THREE.Color(1.0, 0.55, 0.22).multiplyScalar(1.2) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH; varying float vH; varying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvH = aH; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLan; uniform vec3 uWarm; varying float vH; varying vec3 vWP;')
      .replace('#include <opaque_fragment>', `{
        float lip = step(0.84, vH);
        float ao = mix(0.3, 1.0, smoothstep(0.0, 0.75, vH));
        float d = length(vWP.xz - uLan.xz);
        float fall = clamp(1.55 - d * 0.3, 0.2, 1.0);
        // front faces (toward the camera / lit pool) catch more bounce than the flanks
        float front = 0.55 + 0.45 * clamp((vWP.z - uLan.z) / max(d, 1e-3), 0.0, 1.0);
        outgoingLight = outgoingLight * ao + diffuseColor.rgb * uWarm * fall * front * (0.62 * ao + 0.75 * lip);
      }
      #include <opaque_fragment>`);
  };
  riserMat.customProgramCacheKey = () => 'dais-riser';

  const treadPos = [], treadCol = [], treadIdx = [];
  const riserPos = [], riserUv = [], riserH = [], riserIdx = [];
  // tread annulus: rings [radius, y, colour]
  const ring = (rings) => {
    const v0 = treadPos.length / 3;
    for (const [r, y, k] of rings) for (let i = 0; i < 8; i++) { const [x, z] = octPt(cx, cz, r, i); treadPos.push(x, y, z); treadCol.push(k, k, k); }
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < 8; i++) {
      const a = v0 + j * 8 + i, b = v0 + j * 8 + (i + 1) % 8, c = a + 8, e = b + 8;
      treadIdx.push(a, b, c, b, e, c);
    }
  };
  DAIS_STEPS.forEach((s, si) => {
    const next = DAIS_STEPS[si + 1];
    if (next) ring([[next.r - 0.02, s.top, 0.42], [next.r + 0.1, s.top, 0.9], [s.r - 0.07, s.top, 1.0], [s.r, s.top, 1.22]]);
    else ring([[0.01, s.top, 1.0], [s.r - 0.07, s.top, 1.0], [s.r, s.top, 1.22]]);
    // riser quads, u continuous along the perimeter
    let u = 0;
    for (let i = 0; i < 8; i++) {
      const [x0, z0] = octPt(cx, cz, s.r, i), [x1, z1] = octPt(cx, cz, s.r, (i + 1) % 8);
      const len = Math.hypot(x1 - x0, z1 - z0), v0 = riserPos.length / 3;
      const u0 = u / (RISER_TEX_W / PX_PER_M), u1 = (u + len) / (RISER_TEX_W / PX_PER_M);
      riserPos.push(x0, s.bot, z0, x1, s.bot, z1, x1, s.top, z1, x0, s.top, z0);
      riserUv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      riserH.push(0, 0, 1, 1);
      riserIdx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
      u += len;
    }
  });
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(treadPos, 3));
  tg.setAttribute('normal', new THREE.Float32BufferAttribute(treadPos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(treadCol, 3));
  tg.setIndex(treadIdx);
  worldUV(tg, 1.4);
  const tm = new THREE.Mesh(tg, daisMat); tm.castShadow = true; tm.receiveShadow = true;
  group.add(tm);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(riserPos, 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(riserUv, 2));
  rg.setAttribute('aH', new THREE.Float32BufferAttribute(riserH, 1));
  rg.setIndex(riserIdx);
  rg.computeVertexNormals();
  const rm = new THREE.Mesh(rg, riserMat); rm.castShadow = true; rm.receiveShadow = true;
  group.add(rm);
  // ambient occlusion where the bottom riser meets the cobbles: a thin multiply band fading outward
  const aoPos = [], aoUv = [], aoIdx = [], r0 = DAIS_STEPS[0].r, r1 = r0 + 0.2;
  for (let i = 0; i < 8; i++) {
    const [ax, az] = octPt(cx, cz, r0, i), [bx, bz] = octPt(cx, cz, r1, i);
    aoPos.push(ax, 0.012, az, bx, 0.012, bz); aoUv.push(0.5, 0, 0.5, 1);
    const a = i * 2, b = ((i + 1) % 8) * 2;
    aoIdx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(aoPos, 3));
  ag.setAttribute('uv', new THREE.Float32BufferAttribute(aoUv, 2));
  ag.setIndex(aoIdx);
  const aoMesh = new THREE.Mesh(ag, shadowMaterial(solidTexture(), 0.6, false, 1.0));
  aoMesh.material.side = THREE.DoubleSide;
  aoMesh.renderOrder = 2;
  group.add(aoMesh);
}

export function buildProps(ctx) {
  const group = new THREE.Group();
  const yaw = ctx.yaw;
  ctx.lamps = [];
  const R = rng(4242);

  // --- Great Lantern dais ---
  const lantern = PROPS.find(p => p.type === 'great_lantern');
  buildDais(group, lantern);
  ctx.lanternSprite = placeSprite(group, 'great_lantern', lantern.x, lantern.z, lantern.h, yaw, { y: 0.4, native: true });
  group.add(blobShadow(lantern.x, 0.4, lantern.z, 1.0, 0.7, 0.5));

  const oaks = [];
  for (const p of PROPS) {
    if (p.type === 'great_lantern') continue;
    if (p.type === 'oak') { oaks.push(p); continue; }
    const s = placeSprite(group, p.type, p.x, p.z, p.h, yaw, { flip: p.flip });
    const y = s.position.y;
    const [w] = s.userData.size;
    const tree = p.type === 'pine';
    group.add(blobShadow(p.x, y, p.z, w * (tree ? 0.3 : 0.5), w * (tree ? 0.2 : 0.34), tree ? 0.55 : 0.6));
    if (p.type === 'lamp') ctx.lamps.push({ x: p.x, y: y + p.h * 0.86, z: p.z + 0.02, sprite: s });
  }

  // --- volumetric oaks: pixel trunk sprite + a canopy of lit leaf-clump cards ---
  buildOaks(group, oaks, ctx, R);

  // --- fences ---
  for (const [x0, z0, x1, z1] of FENCES) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const segW = 1.5;
    const n = Math.max(1, Math.round(len / segW));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (insideHouse(x, z, 0.2)) continue;
      placeSprite(group, 'fence', x, z, 0.92, yaw, { selfLight: 0.04 });
    }
  }

  // --- bushes & flowers ---
  const bushSpots = [];
  for (let i = 0; i < 1400 && bushSpots.length < 110; i++) {
    const x = -32 + R() * 64, z = -38 + R() * 56;
    if (insideHouse(x, z, 0.3) || plazaDist(x, z) < 1.2) continue;
    const gnd = groundAt(x, z);
    if (gnd[0] < 0.5) continue;
    const edge = isNearCliffTop(x, z) || isNearCliffBase(x, z);
    if (!edge && R() > 0.25) continue;
    bushSpots.push([x, z]);
  }
  // hand-placed hedges around houses / plaza edge
  for (const h of HOUSES) {
    if (h.rot !== 0) continue;
    bushSpots.push([h.x - h.w / 2 - 0.4, h.z + h.d / 2 + 0.6], [h.x + h.w / 2 + 0.5, h.z + h.d / 2 + 0.4]);
  }
  bushSpots.push([-3.4, 6.3], [3.6, 6.2], [-9.5, 5.6], [9.2, 5.2], [-12.6, -1.6], [12.4, -2.6]);
  for (const [x, z] of bushSpots) {
    const s = 0.7 + R() * 0.45;
    const sp = placeSprite(group, 'bush', x, z, s, yaw, { flip: R() < 0.5, selfLight: 0.03 });
    group.add(blobShadow(x, sp.position.y, z, s * 0.7, s * 0.4, 0.45));
  }
  let flowers = 0;
  for (let i = 0; i < 2000 && flowers < 90; i++) {
    const x = -26 + R() * 52, z = -30 + R() * 46;
    if (insideHouse(x, z, 0.4) || plazaDist(x, z) < 1.15) continue;
    if (groundAt(x, z)[0] < 0.5) continue;
    placeSprite(group, 'flowers', x, z, 0.42 + R() * 0.18, yaw, { flip: R() < 0.5, selfLight: 0.05, castShadow: false });
    flowers++;
  }
  // flower beds hugging the plaza rim
  for (let a = 0; a < Math.PI * 2; a += 0.33) {
    const x = Math.cos(a) * 9.6, z = -1.2 + Math.sin(a) * 7.3;
    if (insideHouse(x, z, 0.3) || Math.abs(x) < 2.2 || Math.abs(z + 1) < 1.8) continue;
    placeSprite(group, 'flowers', x, z, 0.46, yaw, { flip: R() < 0.5, selfLight: 0.05, castShadow: false });
  }

  // --- background forest (pines on the high tiers) ---
  for (let i = 0; i < 2600; i++) {
    const x = -48 + R() * 96, z = -50 + R() * 26;
    const L = levelAtCell(x, z);
    if (L < 3 && !(Math.abs(x) > 24)) continue;
    if (insideHouse(x, z, 1.5)) continue;
    if (R() > 0.06) continue;
    // keep a clearing in front of the hilltop chapel so its tower reads against the sky
    if (Math.abs(x + 5.5) < 8 && z > -47 && z < -31) continue;
    const pine = R() < 0.8;
    const hh = pine ? 7 + R() * 3.5 : 6 + R() * 2;
    placeSprite(group, pine ? 'pine' : 'oak', x, z, hh, yaw, { flip: R() < 0.5, selfLight: 0.02 });
  }
  // side trees
  for (let i = 0; i < 60; i++) {
    const side = R() < 0.5 ? -1 : 1;
    const x = side * (19 + R() * 14), z = -24 + R() * 40;
    if (insideHouse(x, z, 1.2)) continue;
    const pine = R() < 0.6;
    placeSprite(group, pine ? 'pine' : 'oak', x, z, pine ? 6.5 + R() * 2.5 : 5.5 + R() * 2, yaw, { flip: R() < 0.5, selfLight: 0.02 });
  }
  // foreground lower tier dressing
  for (let i = 0; i < 40; i++) {
    const x = -22 + R() * 44, z = 9 + R() * 12;
    if (Math.abs(x) < 2) continue;
    if (Math.abs(x) < 9 && z < 14) continue;
    const t = R();
    if (t < 0.5) placeSprite(group, 'bush', x, z, 0.8 + R() * 0.6, yaw, { flip: R() < 0.5 });
    else if (t < 0.8) placeSprite(group, 'flowers', x, z, 0.5, yaw, { castShadow: false });
    else if (Math.abs(x) > 9) placeSprite(group, 'pine', x, z, 5 + R() * 3, yaw, {});
  }

  // --- grass tufts (instanced) ---
  const variants = 4;
  const per = Math.floor(quality.tufts / variants);
  const dummy = new THREE.Object3D();
  for (let v = 0; v < variants; v++) {
    const mat = new THREE.MeshStandardMaterial({ map: tuftTexture(v), alphaTest: 0.5, side: THREE.FrontSide, roughness: 1 });
    const geo = tuftGeometry(0.36, 0.36);
    const im = new THREE.InstancedMesh(geo, mat, per);
    let n = 0;
    for (let i = 0; i < per * 8 && n < per; i++) {
      const x = -34 + R() * 68, z = -40 + R() * 62;
      if (insideHouse(x, z, 0.15)) continue;
      if (plazaDist(x, z) < 1.04 && (v === 3 || Math.hypot(x, z + 1.2) < 6.5 || R() > 0.12)) continue;
      const gnd = groundAt(x, z);
      const edge = isNearCliffTop(x, z) || isNearCliffBase(x, z);
      const dens = gnd[0] > 0.5 ? (edge ? 1 : 0.45) : 0.06;
      if (R() > dens * (0.5 + noise2(x * 0.4, z * 0.4))) continue;
      const s = 0.7 + R() * 0.8;
      dummy.position.set(x, groundY(x, z), z);
      dummy.rotation.set(0, yaw + (R() - 0.5) * 0.5, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      im.setMatrixAt(n++, dummy.matrix);
    }
    im.count = n;
    im.receiveShadow = true;
    im.castShadow = false;
    group.add(im);
  }

  ctx.scene.add(group);
  return group;
}
