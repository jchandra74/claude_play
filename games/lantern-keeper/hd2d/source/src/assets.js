// Asset loading: inlined PNG data URIs -> THREE textures, plus generated emissive masks
// and the sprite (billboard) factory used by props, characters and buildings.
import * as THREE from 'three';

const SRC = window.__ASSETS || {};
const images = {};

export async function loadAll() {
  await Promise.all(Object.entries(SRC).map(([k, url]) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { images[k] = im; res(); };
    im.onerror = rej;
    im.src = url;
  })));
}

export function image(name) {
  const im = images[name];
  if (!im) throw new Error('missing asset ' + name);
  return im;
}

const texCache = new Map();

function canvasOf(name) {
  const im = image(name);
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  return c;
}

// Crisp sprite texture (nearest, no mips)
export function spriteTex(name) {
  const key = 's:' + name;
  if (texCache.has(key)) return texCache.get(key);
  const t = new THREE.Texture(image(name));
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

// Tiling world texture: nearest magnification, mipmapped minification.
export function tileTex(name, anisotropy = 8) {
  const key = 't:' + name;
  if (texCache.has(key)) return texCache.get(key);
  const t = new THREE.Texture(image(name));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

// Emissive mask: keeps only warm, bright pixels (glass, flames), everything else black.
export function emissiveTex(name, opts = {}) {
  const key = 'e:' + name;
  if (texCache.has(key)) return texCache.get(key);
  const thr = opts.threshold ?? 0.58, warm = opts.warm ?? 0.18;
  const region = opts.region; // [y0,y1] fraction of height to restrict
  const c = canvasOf(name);
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const y = Math.floor(i / 4 / c.width) / c.height;
    const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255, a = p[i + 3] / 255;
    const lum = 0.5 * r + 0.4 * gg + 0.1 * b;
    let m = (lum - thr) / 0.18;
    m = Math.max(0, Math.min(1, m)) * (r - b > warm ? 1 : 0) * a;
    if (region && (y < region[0] || y > region[1])) m = 0;
    // boost toward a hot core
    p[i] = Math.min(255, p[i] * m * 1.0);
    p[i + 1] = Math.min(255, p[i + 1] * m * 0.92);
    p[i + 2] = Math.min(255, p[i + 2] * m * 0.6);
    p[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  texCache.set(key, t);
  return t;
}

// Soft radial glow texture used for halos / blob shadows.
let glowTex = null;
export function radialTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function aspect(name) { const im = image(name); return im.width / im.height; }
export function size(name) { const im = image(name); return [im.width, im.height]; }

// Sprite normals: tilted toward camera and sky so that lights in any direction
// (e.g. the Great Lantern behind a character) still read on flat sprites.
function spriteGeometry(w, h, flip) {
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2, 0);
  const n = geo.attributes.normal;
  const v = new THREE.Vector3(0, 0.86, 0.52).normalize();
  for (let i = 0; i < n.count; i++) n.setXYZ(i, v.x, v.y, v.z);
  if (flip) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  }
  return geo;
}

const matCache = new Map();
function unlitMaterial(name, opts) {
  // For light-source props (Great Lantern, street lamps): their own point light sits inside the
  // sprite plane and would blow them out, so they are shaded flat + an emissive glass mask.
  const m = new THREE.MeshBasicMaterial({ map: spriteTex(name), alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(opts.unlit) });
  const emi = emissiveTex(name, opts.emissiveOpts || {});
  const k = opts.emissiveIntensity ?? 3;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tEmi = { value: emi }; sh.uniforms.uEmi = { value: k };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tEmi; uniform float uEmi;')
      .replace('#include <opaque_fragment>', 'outgoingLight += texture2D(tEmi, vMapUv).rgb * uEmi;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'unlit-emi';
  return m;
}

function spriteMaterial(name, opts) {
  const key = name + '|' + (opts.emissive ? opts.emissiveIntensity : 0) + '|' + (opts.tint || '') + '|' + (opts.unlit || '');
  if (matCache.has(key)) return matCache.get(key);
  if (opts.unlit) { const um = unlitMaterial(name, opts); matCache.set(key, um); return um; }
  const map = spriteTex(name);
  const m = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0,
    color: opts.tint ? new THREE.Color(opts.tint) : 0xffffff,
  });
  if (opts.emissive) {
    m.emissiveMap = emissiveTex(name, opts.emissiveOpts || {});
    m.emissive = new THREE.Color(1, 0.85, 0.6);
    m.emissiveIntensity = opts.emissiveIntensity ?? 3;
  }
  // per-sprite subtle self-illumination so the art stays readable at night
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSelf = { value: opts.selfLight ?? 0.05 };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSelf;')
      .replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * uSelf;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'sprite' + (opts.selfLight ?? 0.05);
  matCache.set(key, m);
  return m;
}

const depthMatCache = new Map();
function depthMats(name) {
  if (depthMatCache.has(name)) return depthMatCache.get(name);
  const map = spriteTex(name);
  const d = {
    depth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide }),
    dist: new THREE.MeshDistanceMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }),
  };
  depthMatCache.set(name, d);
  return d;
}

/**
 * Billboard sprite standing on the ground at its bottom-centre.
 * opts: h (height m), flip, emissive, emissiveIntensity, castShadow, yaw, tint, selfLight, pivotY
 */
export function makeSprite(name, opts = {}) {
  const [pw, ph] = size(name);
  const h = opts.h ?? 1;
  const w = h * pw / ph;
  const geo = spriteGeometry(w, h, opts.flip);
  if (opts.pivotY) geo.translate(0, -opts.pivotY, 0);
  const mesh = new THREE.Mesh(geo, spriteMaterial(name, opts));
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  const dm = depthMats(name);
  mesh.customDepthMaterial = dm.depth;
  mesh.customDistanceMaterial = dm.dist;
  mesh.rotation.y = opts.yaw ?? 0;
  mesh.userData.sprite = name;
  mesh.userData.size = [w, h];
  return mesh;
}

// Flat decal (doors, windows, signs) mounted on a wall: normal along local +z.
export function makeDecal(name, h, opts = {}) {
  const [pw, ph] = size(name);
  const w = h * pw / ph;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2, 0);
  const key = 'decal:' + name + (opts.emissive ? opts.emissiveIntensity : '');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: spriteTex(name), alphaTest: 0.5, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    if (opts.emissive) {
      m.emissiveMap = emissiveTex(name, opts.emissiveOpts || {});
      m.emissive = new THREE.Color(1, 0.82, 0.55);
      m.emissiveIntensity = opts.emissiveIntensity ?? 3;
    }
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    matCache.set(key, m);
  }
  const mesh = new THREE.Mesh(geo, m);
  const dm = depthMats(name);
  mesh.customDepthMaterial = dm.depth;
  mesh.customDistanceMaterial = dm.dist;
  mesh.castShadow = opts.castShadow ?? false;
  mesh.receiveShadow = true;
  mesh.userData.size = [w, h];
  return mesh;
}
