// Characters: Pip, Moss and the villagers as lit billboard sprites on the shared pixel grid.
// Grounding: instead of shadow-mapped smudges (the lantern's point light threw long shadows in every
// direction), each character gets a dense pixel contact shadow under the feet plus a short silhouette
// shadow cast along the moonlight direction, so every shadow in the plaza agrees.
import * as THREE from 'three';
import { CHARACTERS, GREAT_LANTERN_LIGHT } from './layout.js';
import { makeSprite, spriteTex, size as imgSize } from './assets.js';
import { groundY } from './terrain.js';
import { blobShadow, pxName, shadowMaterial } from './props.js';

function silhouetteShadow(name, w, h, flip) {
  const len = h * 0.6;                      // short: these are night shadows from a high moon
  const geo = new THREE.PlaneGeometry(w, len);
  geo.translate(0, len / 2, 0);             // feet at the origin, head pointing along +y (local)
  geo.rotateX(-Math.PI / 2);                // lay flat: local +y -> world -z
  const mat = shadowMaterial(spriteTex(name), 0.62, flip, 0.55);
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  return m;
}

// Character material: the sprites are the focal point, so they get their own shading on top of the
// scene lights: a warm front fill from the nearest light, a little extra saturation, and a one-pixel
// rim on the silhouette edges that face that light (found by testing the neighbouring texel's alpha
// in the light's on-screen direction), plus a faint cool moon rim along the top edges.
const SCALE = 1.6;                         // characters read a touch larger than the props around them
function characterMaterial(name, light, flip, yaw, pos) {
  const [tw, th] = imgSize(name);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const dx = (light.x - pos.x) * right.x + (light.z - pos.z) * right.z;
  const du = (Math.abs(dx) < 0.15 ? 0 : Math.sign(dx)) * (flip ? -1 : 1);
  const m = new THREE.MeshStandardMaterial({ map: spriteTex(name), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTexel = { value: new THREE.Vector2(1 / tw, 1 / th) };
    sh.uniforms.uRimDir = { value: new THREE.Vector2(du, 1) };
    sh.uniforms.uRimCol = { value: light.color.clone().multiplyScalar(light.k) };
    sh.uniforms.uFill = { value: light.color.clone().multiplyScalar(0.2 * light.k).add(new THREE.Color(0.1, 0.1, 0.12)) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uTexel, uRimDir; uniform vec3 uRimCol, uFill;')
      .replace('#include <opaque_fragment>', `{
        float aS = texture2D(map, vMapUv + vec2(uRimDir.x, 0.0) * uTexel).a;
        float aD = texture2D(map, vMapUv + uRimDir * uTexel).a;
        float aU = texture2D(map, vMapUv + vec2(0.0, uTexel.y)).a;
        float aS2 = texture2D(map, vMapUv + vec2(uRimDir.x * 2.0, 0.0) * uTexel).a;
        float rim = max(step(aS, 0.5) * step(0.5, abs(uRimDir.x)), step(aD, 0.5) * 0.6);
        rim = max(rim, step(aS2, 0.5) * step(0.5, abs(uRimDir.x)) * 0.15);
        float topRim = step(aU, 0.5);
        vec3 base = diffuseColor.rgb;
        float bl = dot(base, vec3(0.3, 0.59, 0.11));
        vec3 col = outgoingLight + base * uFill;
        float cl = dot(col, vec3(0.3, 0.59, 0.11));
        col = max(mix(vec3(cl), col, 1.18), 0.0);
        // soft shoulder so pale faces under the hot pool keep their pixel detail instead of clipping
        col *= 1.0 / (1.0 + max(cl - 0.5, 0.0) * 0.9);
        col += uRimCol * rim * (0.18 + bl * 0.9);
        col += vec3(0.05, 0.08, 0.12) * topRim * (1.0 - rim);
        outgoingLight = col;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'character-rim';
  return m;
}

// strongest light reaching a character: the Great Lantern or a street lamp
function keyLight(ctx, x, z) {
  const L = GREAT_LANTERN_LIGHT;
  const warm = new THREE.Color(1.0, 0.6, 0.26);
  let best = { x: L.x, z: L.z, k: 0, color: warm };
  const cands = [{ x: L.x, z: L.z, w: 3.0 }, ...(ctx.lamps || []).map(l => ({ x: l.x, z: l.z, w: 1.0 }))];
  for (const c of cands) {
    const d = Math.hypot(c.x - x, c.z - z);
    const k = c.w / (1 + d * d * 0.12);
    if (k > best.k) best = { x: c.x, z: c.z, k, color: warm };
  }
  best.k = Math.min(1.0, Math.max(0.35, best.k));
  return best;
}

export function buildCharacters(ctx) {
  const group = new THREE.Group();
  ctx.characters = [];
  for (const c0 of CHARACTERS) {
    const c = { ...c0, h: c0.h * SCALE };
    const name = pxName(c.sprite, c.h);
    const s = makeSprite(name, { h: c.h, yaw: ctx.yaw, flip: c.flip, selfLight: 0.1, castShadow: false });
    s.material = characterMaterial(name, keyLight(ctx, c.x, c.z), c.flip, ctx.yaw, c);
    const y = groundY(c.x, c.z);
    s.position.set(c.x, y, c.z);
    group.add(s);
    const [w] = s.userData.size;
    // contact pool sits slightly toward the camera so it reads below the feet, not hidden behind them;
    // a tight dark core plus a wider soft pool
    group.add(blobShadow(c.x + 0.03, y, c.z + 0.07, Math.max(0.24, w * 0.5), Math.max(0.13, w * 0.26), 0.95));
    group.add(blobShadow(c.x + 0.03, y - 0.003, c.z + 0.05, Math.max(0.34, w * 0.78), Math.max(0.2, w * 0.42), 0.5));
    const sil = silhouetteShadow(name, w, c.h, c.flip);
    sil.position.set(c.x, y + 0.025, c.z);
    sil.visible = false;                    // oriented once the moon exists (lighting builds after us)
    group.add(sil);
    ctx.characters.push({ def: c, sprite: s, baseY: y, sil });
  }
  ctx.scene.add(group);
  return group;
}

const _d = new THREE.Vector3();
let oriented = false;
// Idle animation hook (kept static so screenshots are deterministic). Orients the silhouette shadows
// along the moon's light direction on the first frame.
export function updateCharacters(ctx, t) {
  if (oriented) return;
  oriented = true;
  if (ctx.moon) {
    _d.copy(ctx.moon.target.position).sub(ctx.moon.position);
  } else _d.set(1, -1, -0.7);
  _d.y = 0;
  if (_d.lengthSq() < 1e-6) _d.set(0.6, 0, -0.8);
  _d.normalize();
  // geometry's shadow axis points to world -z; rotate it onto the light direction
  const ang = Math.atan2(-_d.x, -_d.z);
  for (const c of ctx.characters) { c.sil.rotation.y = ang; c.sil.visible = true; }
}
