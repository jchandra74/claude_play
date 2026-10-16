// Night lighting.
//  - Cool, dim moonlight (shadow-mapped) from the moon's sky direction + a deep blue-teal hemisphere ambient.
//  - The Great Lantern: one real shadow-casting point light with a steep (decay 3) falloff, so it throws a
//    hot pool round its base that dies into cool darkness before the plaza edge.
//  - "Pool lights": cheap analytic warm lights evaluated inside every MeshStandardMaterial (patched
//    lights chunk, uniform arrays, windowed falloff). Street lamps, lit windows and doorways each get one,
//    so every source puts a visible pool on the ground / walls at any quality level.
//  - Light-source sprites (lantern, lamps) are re-shaded so they glow from the glass outward.
//  - Character sprites get bent normals so they read warm on the side facing a light and cool on the other.
import * as THREE from 'three';
import { GREAT_LANTERN_LIGHT } from './layout.js';
import { radialTex } from './assets.js';
import { quality } from './config.js';

export const LANTERN_COLOR = new THREE.Color(1.0, 0.56, 0.2);
export const LAMP_COLOR = new THREE.Color(1.0, 0.62, 0.28);
export const WINDOW_COLOR = new THREE.Color(1.0, 0.55, 0.22);

export const MOON_DIR = new THREE.Vector3(-0.35, 0.55, -0.75).normalize(); // shared with sky.js
const MOON_COLOR = new THREE.Color(0.42, 0.66, 1.0);

// ---------- Great Lantern level (0 = out, 1 = fully lit) ----------
// One shared uniform object: props.js (dais bounce, oak rim), particles.js (embers), post.js (grade)
// and the materials below all read it, so setLanternLevel() is a handful of scalar writes per frame.
export const lanternLevelU = { value: 1 };
const LV = { k: 1, t: 0 };
const URL_LANTERN = (() => {
  try {
    const v = new URLSearchParams(location.search).get('lantern');
    if (v === null || v === '') return null;
    const f = parseFloat(v);
    return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : null;
  } catch (e) { return null; }
})();
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const POOL_MAX = quality.name === 'high' ? 32 : quality.name === 'med' ? 22 : 14;

// ---------- analytic pool lights (patched into the standard lighting chunk) ----------
const poolU = {
  uPoolPos: { value: Array.from({ length: POOL_MAX }, () => new THREE.Vector4()) },
  uPoolCol: { value: Array.from({ length: POOL_MAX }, () => new THREE.Vector4()) },
  uPoolCount: { value: 0 },
};
// Shared GLSL: accumulate diffuse irradiance from all pools at view-space position P with normal N.
const POOL_SUM = `
  for ( int pi = 0; pi < ${POOL_MAX}; pi ++ ) {
    if ( pi >= uPoolCount ) break;
    vec3 plv = uPoolPos[ pi ].xyz - POOL_P;
    float pd2 = dot( plv, plv );
    float pr2 = uPoolPos[ pi ].w;
    if ( pd2 < pr2 ) {
      float pwin = 1.0 - pd2 / pr2; pwin *= pwin;
      float ndl = max( dot( POOL_N, plv ) * inversesqrt( pd2 + 1e-4 ), 0.0 );
      POOL_OUT += uPoolCol[ pi ].rgb * ( pwin * ndl / ( pd2 * uPoolCol[ pi ].w + 1.0 ) );
    }
  }`;
const POOL_DECL = `
uniform vec4 uPoolPos[${POOL_MAX}];
uniform vec4 uPoolCol[${POOL_MAX}];
uniform int uPoolCount;
#ifdef POOL_VERTEX
varying vec3 vPoolIrr;
#endif`;
// Moonlight response ("Purkinje" night shift): the moon and the sky ambient are re-tinted per pixel
// so that surfaces outside the warm pools read as saturated blue-teal whatever their albedo
// (brown cobbles / timber under a blue light would otherwise come out muddy grey-olive).
// Only the moon (directional) and hemisphere terms are affected; the lantern, lamps and windows keep
// the full albedo colour, so warm pools pop against a cool, luminous field.
const MOON_GLSL = `
#ifndef MOON_KD
#define MOON_KD 0.8
#endif
#ifndef MOON_KI
#define MOON_KI 0.86
#endif
vec3 moonTint( vec3 c, float k ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  return mix( c, l * vec3( 0.26, 0.92, 2.05 ), k );
}`;
let chunkPatched = false;
function patchChunks() {
  if (chunkPatched) return;
  chunkPatched = true;
  THREE.ShaderChunk.lights_pars_begin += POOL_DECL + MOON_GLSL;
  const lb = THREE.ShaderChunk.lights_fragment_begin;
  const dirTag = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const rectTag = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
  if (lb.includes(dirTag) && lb.includes(rectTag)) {
    THREE.ShaderChunk.lights_fragment_begin = lb
      .replace(dirTag, 'vec3 moonPre = reflectedLight.directDiffuse;\n' + dirTag)
      .replace(rectTag, 'reflectedLight.directDiffuse = moonPre + moonTint( reflectedLight.directDiffuse - moonPre, MOON_KD );\n' + rectTag);
  }
  THREE.ShaderChunk.lights_fragment_end += `
#if defined( RE_IndirectDiffuse )
  reflectedLight.indirectDiffuse = moonTint( reflectedLight.indirectDiffuse, MOON_KI );
#endif
#if defined( MOON_RIM ) && ( NUM_DIR_LIGHTS > 0 )
{
  // foliage: cool moon rim on the silhouette lobes facing the moon, so the crown has a light direction
  float mnv = saturate( dot( geometryNormal, geometryViewDir ) );
  float mnl = dot( geometryNormal, directionalLights[ 0 ].direction );
  float mrim = pow( 1.0 - mnv, 1.6 ) * smoothstep( -0.35, 0.6, mnl ) + 0.35 * smoothstep( 0.2, 0.9, mnl );
  reflectedLight.directDiffuse += moonTint( directionalLights[ 0 ].color, 0.5 ) * mrim * 2.2 * BRDF_Lambert( material.diffuseColor );
}
#endif

`;
  // Diffuse-only (every surface here is rough). Large receivers (ground, walls) evaluate per pixel;
  // small alpha-tested sprites (tufts, flowers, characters, decals) evaluate per vertex (POOL_VERTEX),
  // which keeps the heavy overdraw of foliage cheap.
  THREE.ShaderChunk.lights_fragment_end = `
#if defined( RE_Direct )
{
#ifdef POOL_VERTEX
  vec3 poolIrr = vPoolIrr;
#else
  vec3 poolIrr = vec3( 0.0 );
#define POOL_P geometryPosition
#define POOL_N geometryNormal
#define POOL_OUT poolIrr
${POOL_SUM}
#undef POOL_P
#undef POOL_N
#undef POOL_OUT
#endif
  reflectedLight.directDiffuse += poolIrr * BRDF_Lambert( material.diffuseColor );
}
#endif
` + THREE.ShaderChunk.lights_fragment_end;
}

const POOL_VS = `
#ifdef POOL_VERTEX
{
  vec3 pvN = normalize( transformedNormal );
  vPoolIrr = vec3( 0.0 );
#define POOL_P mvPosition.xyz
#define POOL_N pvN
#define POOL_OUT vPoolIrr
${POOL_SUM}
#undef POOL_P
#undef POOL_N
#undef POOL_OUT
}
#endif`;

function hookMaterial(m) {
  if (!m || !m.isMeshStandardMaterial || m.userData.poolHooked) return;
  m.userData.poolHooked = true;
  const perVertex = m.alphaTest > 0;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey();
  // foliage keeps a little more of its green under the moon and gets a moon rim
  const leafy = /leafclump/.test(prevKey) || /tuft|grass|bush|pine|oak/.test(m.map && m.map.name || '');
  const leafDefs = /leafclump/.test(prevKey) ? '#define MOON_RIM\n#define MOON_KD 0.6\n#define MOON_KI 0.7\n' : leafy ? '#define MOON_KD 0.7\n#define MOON_KI 0.78\n' : '';
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    if (leafDefs) sh.fragmentShader = leafDefs + sh.fragmentShader;
    sh.uniforms.uPoolPos = poolU.uPoolPos;
    sh.uniforms.uPoolCol = poolU.uPoolCol;
    sh.uniforms.uPoolCount = poolU.uPoolCount;
    if (perVertex) {
      sh.fragmentShader = '#define POOL_VERTEX\n' + sh.fragmentShader;
      sh.vertexShader = '#define POOL_VERTEX\n' + sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + POOL_DECL)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + POOL_VS);
    }
  };
  m.customProgramCacheKey = () => prevKey + (perVertex ? '|poolv' : '|pool') + (leafDefs ? '|leaf' + leafDefs.length : '');
}

// ---------- glow-from-the-glass shading for the light-source sprites ----------
function glassShade(mesh, center, radius, key, levelU) {
  const m = mesh.material;
  if (!m || m.userData.glassHooked) return;
  m.userData.glassHooked = true;
  const [w, h] = mesh.userData.size || [1, 1];
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    sh.uniforms.uGlass = { value: new THREE.Vector4(center[0], center[1], w / h, radius) };
    sh.uniforms.uLevel = levelU;
    const glass = `{
        vec2 gq = vec2((vMapUv.x - uGlass.x) * uGlass.z, vMapUv.y - uGlass.y);
        float gd = length(gq) / uGlass.w;
        float g = exp(-gd * gd);
        // body away from the glass: dark, moon-cool metal; near the glass: warm gold rim light.
        // Kept well below clipping so the mullions stay dark against the panes.
        vec3 base = outgoingLight;
        float bl = dot(base, vec3(0.2126, 0.7152, 0.0722));
        vec3 coolMetal = bl * vec3(0.16, 0.3, 0.62) + base * 0.08;
        vec3 warmMetal = base * vec3(1.05, 0.72, 0.42);
        outgoingLight = mix(coolMetal, warmMetal, g * uLevel);
        // warm bounce from the lit dais on the plinth
        outgoingLight = mix(outgoingLight, base * vec3(0.95, 0.6, 0.32), 0.75 * uLevel * (1.0 - smoothstep(0.03, 0.2, vMapUv.y)));
        // glowing panes: a hot core falling off to deep amber at the frame, never a flat white slab
        vec3 em = texture2D(tEmi, vMapUv).rgb;
        float core = exp(-gd * gd * 2.2);
        // unlit: the panes go to dark, moon-glazed glass with a pale sheen at the top
        float pane = smoothstep(0.02, 0.2, dot(em, vec3(0.33)));
        vec3 darkGlass = vec3(0.012, 0.022, 0.045) + vec3(0.03, 0.06, 0.12) * smoothstep(0.4, 1.0, vMapUv.y - uGlass.y + 0.5) * (0.6 + 0.4 * core);
        outgoingLight = mix(outgoingLight, darkGlass, pane * (1.0 - uLevel));
        outgoingLight += em * uEmi * uLevel * uLevel * mix(vec3(0.16, 0.085, 0.03), vec3(0.36, 0.24, 0.12), core);
      }`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uGlass; uniform float uLevel;')
      .replace('outgoingLight += texture2D(tEmi, vMapUv).rgb * uEmi;', glass);
  };
  m.customProgramCacheKey = () => 'unlit-emi-' + key;
  m.needsUpdate = true;
}

// ---------- wall sconces: the glass sits inside the iron cage, so the cage itself becomes the lit
// fixture: six glazed panes between dark iron mullions, glowing from a hot core (scaled by the
// sconce's own level so they can dim / flicker with the Great Lantern) ----------
const CAGE_VS = `varying vec2 vUv; varying vec3 vN, vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`;
const CAGE_FS = `uniform float uLevel; uniform vec3 uHot, uAmber; varying vec2 vUv; varying vec3 vN, vV;
void main(){
  float f = fract(vUv.x * 6.0);
  float mull = step(f, 0.12) + step(0.88, f);
  float rail = step(vUv.y, 0.12) + step(0.86, vUv.y);
  float frame = clamp(mull + rail, 0.0, 1.0);
  float cx = 1.0 - abs(f - 0.5) * 2.0, cy = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float core = pow(max(cx * cy, 0.0), 0.7);
  float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  vec3 glow = mix(uAmber, uHot, core * (0.4 + 0.6 * facing)) * uLevel;
  vec3 dark = vec3(0.012, 0.02, 0.04) + vec3(0.02, 0.04, 0.08) * vUv.y;
  vec3 pane = mix(dark, glow, smoothstep(0.0, 0.25, uLevel));
  vec3 iron = vec3(0.025, 0.02, 0.022) + uAmber * 0.08 * uLevel * (1.0 - rail * 0.5);
  gl_FragColor = vec4(mix(pane, iron, frame), 1.0);
}`;
function sconceFixture(lamp) {
  const glass = lamp.sprite, g = glass && glass.parent;
  if (!g || glass.userData.size) return null;
  const levelU = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    vertexShader: CAGE_VS, fragmentShader: CAGE_FS,
    uniforms: { uLevel: levelU, uHot: { value: new THREE.Color(5.0, 3.1, 1.4) }, uAmber: { value: new THREE.Color(1.5, 0.62, 0.16) } },
  });
  for (const c of g.children) {
    const p = c.geometry && c.geometry.parameters;
    if (c.isMesh && c !== glass && p && p.radiusTop === 0.11 && c.geometry.type === 'CylinderGeometry') {
      c.material = [mat, c.material, c.material];
    }
  }
  return levelU;
}

// ---------- characters: the crispest, brightest thing in their area ----------
// Extra front fill from the nearby warm pools, a cool moon fill so the shadow side never crushes,
// a warm rim on the outline pixels (texture-alpha edge) scaled by how much warm light reaches them,
// and a little extra saturation.
function heroShade(mesh) {
  const m = mesh.material;
  if (!m || !m.isMeshStandardMaterial || m.userData.heroHooked || !m.map) return;
  m.userData.heroHooked = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    const img = m.map.image;
    sh.uniforms.uTexel = { value: new THREE.Vector2(1 / ((img && img.width) || 64), 1 / ((img && img.height) || 64)) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uTexel;')
      .replace('#include <opaque_fragment>', `{
        #ifdef POOL_VERTEX
        vec3 warmIrr = vPoolIrr;
        #else
        vec3 warmIrr = vec3( 0.0 );
        #endif
        float aMin = min( min( texture2D( map, vMapUv + vec2( uTexel.x, 0.0 ) ).a, texture2D( map, vMapUv - vec2( uTexel.x, 0.0 ) ).a ),
                          min( texture2D( map, vMapUv + vec2( 0.0, uTexel.y ) ).a, texture2D( map, vMapUv - vec2( 0.0, uTexel.y ) ).a ) );
        float edge = 1.0 - step( 0.5, aMin );
        float wl = dot( warmIrr, vec3( 0.3, 0.59, 0.11 ) );
        outgoingLight += diffuseColor.rgb * ( warmIrr * 0.32 + vec3( 0.035, 0.06, 0.11 ) );
        outgoingLight += edge * ( vec3( 1.0, 0.6, 0.28 ) * min( wl, 1.5 ) * 0.35 + vec3( 0.03, 0.06, 0.12 ) );
        float ol = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
        outgoingLight = max( mix( vec3( ol ), outgoingLight, 1.18 ), 0.0 );
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => prevKey + '|hero';
  m.needsUpdate = true;
}

// ---------- bent normals for character sprites ----------
function bendSpriteNormals(mesh, k = 0.75) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position, n = geo.attributes.normal;
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) { minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i)); }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const sx = ((pos.getX(i) - minX) / Math.max(maxX - minX, 1e-4)) * 2 - 1;
    v.set(sx * k, 0.8, 0.55).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}

export function buildLighting(ctx) {
  const { scene } = ctx;
  ctx.hazeLights = [];
  ctx.flicker = [];
  ctx.pools = [];
  patchChunks();

  // night atmosphere: deep blue-teal distance fog
  if (scene.fog) { scene.fog.color.setRGB(0.03, 0.075, 0.15); scene.fog.density = 0.0072; }

  // moon: cool, dim, from the moon's direction in the sky (behind-left), rims and casts long shadows
  const moon = new THREE.DirectionalLight(MOON_COLOR, 0.62);
  moon.position.copy(MOON_DIR).multiplyScalar(45).add(new THREE.Vector3(0, 0, -2));
  moon.target.position.set(0, 0, -2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  const sc = moon.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 120;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.035;
  moon.shadow.radius = 2;
  scene.add(moon, moon.target);
  ctx.moon = moon;

  // ambient: deep blue-teal sky, near-black ground bounce
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.14, 0.3, 0.6), new THREE.Color(0.03, 0.05, 0.09), 1.55);
  scene.add(hemi);
  ctx.hemi = hemi;
  const FX = ctx.lanternFx = { lamps: [], lanternPools: [], lanternHalos: [], bulbs: null, chars: [] };

  // ---- Great Lantern: the key light of the scene ----
  const L = GREAT_LANTERN_LIGHT;
  const LI = 640;
  const lan = new THREE.PointLight(LANTERN_COLOR, LI, 10.5, 3);
  lan.position.set(L.x, L.y, L.z);
  lan.castShadow = quality.pointShadow;
  lan.shadow.mapSize.set(quality.pointShadowSize, quality.pointShadowSize);
  lan.shadow.bias = -0.002;
  lan.shadow.normalBias = 0.04;
  lan.shadow.camera.near = 0.2;
  lan.shadow.camera.far = 40;
  scene.add(lan);
  const lanFl = { light: lan, base: LI, seed: 0.3, mul: 1 };
  ctx.flicker.push(lanFl);
  FX.lanternFlicker = lanFl;
  FX.lanternHaze = { pos: lan.position.clone(), color: LANTERN_COLOR.clone(), strength: 0.9, base: 0.9 };
  ctx.hazeLights.push(FX.lanternHaze);
  FX.lanternHalos.push(halo(ctx, lan.position, LANTERN_COLOR, 5.5, 0.45, true));
  FX.lanternHalos.push(halo(ctx, lan.position, new THREE.Color(1, 0.7, 0.4), 2.2, 0.22, true));
  // a broad, soft warm fill so the houses facing the plaza catch a little of the lantern too
  FX.lanternPools.push(addPool(ctx, new THREE.Vector3(L.x, L.y + 0.5, L.z), LANTERN_COLOR, 0.16, 13, 0.02, 0));
  // hot core right round the dais
  FX.lanternPools.push(addPool(ctx, new THREE.Vector3(L.x, 2.4, L.z + 1.6), LANTERN_COLOR, 9, 5.5, 1.0, 0));

  // ---- street lamps ----
  // each lamp relights at its own threshold, nearest the Great Lantern first (the flame spreading out)
  let maxD = 1;
  for (const l of ctx.lamps || []) maxD = Math.max(maxD, Math.hypot(l.x - L.x, l.z - L.z));
  for (const l of ctx.lamps || []) {
    const p = new THREE.Vector3(l.x, l.y, l.z);
    const seed = l.x * 0.37 + l.z;
    const pool = addPool(ctx, p, LAMP_COLOR, 24, 5.2, 1.0, 1, seed);
    const haze = { pos: p, color: LAMP_COLOR.clone(), strength: 0.45, base: 0.45 };
    ctx.hazeLights.push(haze);
    const halos = [halo(ctx, p, LAMP_COLOR, 1.4, 1.2, true), halo(ctx, p, new THREE.Color(1, 0.85, 0.6), 0.45, 1.6, true)];
    const d = Math.hypot(l.x - L.x, l.z - L.z) / maxD;
    FX.lamps.push({ lamp: l, pool, haze, halos, seed, thr: 0.3 + 0.5 * d, level: 1, cage: sconceFixture(l) });
  }

  // ---- doorways of lit houses: warm spill onto the step / path ----
  for (const h of ctx.houses || []) {
    if (!h.light || !h.group) continue;
    // glow round the door frame only, plus spill onto the step / path from just inside the doorway
    const p = new THREE.Vector3(h.doorX, 1.3, h.d / 2 + 0.45);
    h.group.localToWorld(p);
    addPool(ctx, p, WINDOW_COLOR, 2.6, 2.2, 1.6, 2);
    const q = new THREE.Vector3(h.doorX, 1.1, h.d / 2 - 0.08);
    h.group.localToWorld(q);
    addPool(ctx, q, WINDOW_COLOR, 5, 3.4, 0.8, 2);
  }

  // ---- windows (registered by buildings): a small halo on each, a tight warm pool hugging each
  //      bright window (so the wall glows only round the frame, not the whole facade), and one low
  //      ground-spill pool per lit wall out in front of it ----
  const n = new THREE.Vector3();
  const walls = new Map();
  for (const hh of ctx.halos || []) {
    const p = new THREE.Vector3(0, hh.y - hh.obj.position.y, 0.25);
    hh.obj.localToWorld(p);
    hh.obj.getWorldDirection(n);
    halo(ctx, p, WINDOW_COLOR, hh.size * 0.9, 0.5 * hh.strength);
    if (hh.strength < 0.55) continue;
    addPool(ctx, p.clone().addScaledVector(n, 0.22), WINDOW_COLOR, 1.6 * hh.strength, 1.25 + hh.size * 0.4, 2.2, 3);
    const key = (hh.obj.parent ? hh.obj.parent.uuid : '') + '|' + n.x.toFixed(1) + ',' + n.z.toFixed(1);
    let w = walls.get(key);
    if (!w) walls.set(key, w = { sum: new THREE.Vector3(), n: n.clone(), k: 0, s: 0, minX: Infinity, maxX: -Infinity, minY: Infinity });
    w.sum.add(p); w.k++; w.s += hh.strength * hh.strength;
    w.minY = Math.min(w.minY, p.y);
    const along = p.x * -n.z + p.z * n.x;
    w.minX = Math.min(w.minX, along); w.maxX = Math.max(w.maxX, along);
  }
  for (const w of walls.values()) {
    // sits just behind the wall plane: the wall itself gets nothing (N.L < 0), the ground in front
    // gets a pool as if the light fell out through the windows
    const q = w.sum.divideScalar(w.k).addScaledVector(w.n, -0.08);
    q.y = Math.min(w.minY, 1.5);
    const span = w.maxX - w.minX;
    addPool(ctx, q, WINDOW_COLOR, 2.0 * w.s / Math.sqrt(w.k), 2.6 + span * 0.35, 1.0 / (1 + span * 0.25), 4);
  }

  // keep the most important pools if the quality budget is small
  ctx.pools.sort((a, b) => a.prio - b.prio || b.weight - a.weight);

  // hook every standard material in the scene to the pool uniforms
  scene.traverse(o => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(hookMaterial);
  });

  // light-source sprites glow from the glass outward
  FX.lanternGlass = { value: 1 };
  FX.lampGlass = { value: 1 };
  if (ctx.lanternSprite) glassShade(ctx.lanternSprite, [0.5, 0.72], 0.17, 'lantern', FX.lanternGlass);
  const lampSprite = (ctx.lamps || []).find(l => l.sprite && l.sprite.userData.size);
  if (lampSprite) glassShade(lampSprite.sprite, [0.5, 0.86], 0.13, 'lamp', FX.lampGlass);

  // festoon bulbs strung from the lantern crown (plaza.js): dim with it
  scene.traverse(o => {
    if (FX.bulbs || !o.isInstancedMesh || !o.material || !o.material.isMeshBasicMaterial) return;
    const p = o.geometry && o.geometry.parameters;
    if (o.geometry.type === 'SphereGeometry' && p && Math.abs(p.radius - 0.055) < 1e-4) FX.bulbs = { mat: o.material, base: o.material.color.clone() };
  });

  // characters: warm on the side facing a light, cool on the other
  for (const c of ctx.characters || []) {
    if (!c.sprite || !c.sprite.geometry) continue;
    bendSpriteNormals(c.sprite);
    // capture the character shader's warm rim / fill uniforms so the lantern level can cool them
    const cm = c.sprite.material;
    if (cm && !cm.userData.levelHooked) {
      cm.userData.levelHooked = true;
      const ent = { sh: null };
      const prevC = cm.onBeforeCompile;
      cm.onBeforeCompile = function (sh, r) {
        prevC.call(this, sh, r);
        ent.sh = sh.uniforms;
        if (sh.uniforms.uRimCol && !ent.rim) { ent.rim = sh.uniforms.uRimCol.value.clone(); ent.fill = sh.uniforms.uFill ? sh.uniforms.uFill.value.clone() : null; }
        applyChar(ent, LV.k);
      };
      FX.chars.push(ent);
    }
    // characters.js now does its own warm fill, rim and saturation; hooking both declares uTexel twice
    // heroShade(c.sprite) is not applied here: characters.js does its own warm fill, rim and saturation.
  }

  FX.moonBase = moon.intensity; FX.hemiBase = hemi.intensity;
  updateLighting(ctx, 0);
  setLanternLevel(ctx, URL_LANTERN ?? 1);
}

const COOL_RIM = new THREE.Color(0.1, 0.17, 0.32), COOL_FILL = new THREE.Color(0.05, 0.08, 0.13);
function applyChar(ent, k) {
  if (!ent.sh || !ent.rim) return;
  const kl = sstep(0.0, 0.45, k);
  ent.sh.uRimCol.value.copy(ent.rim).multiplyScalar(0.12 + 0.88 * kl).lerp(COOL_RIM, (1 - kl) * 0.6);
  if (ent.fill && ent.sh.uFill) ent.sh.uFill.value.copy(ent.fill).multiplyScalar(0.55 + 0.45 * kl).add(COOL_FILL.clone().multiplyScalar(1 - kl));
}

// Low, guttering flame for an unlit / relighting lamp: a dim ember glow that breathes and drops out.
function gutter(t, seed) {
  const n = 0.55 + 0.25 * Math.sin(t * 9.3 + seed * 7) + 0.2 * Math.sin(t * 23.1 + seed * 3);
  const q = Math.sin(Math.floor(t * 5 + seed * 11) * 12.9898 + seed) * 43758.5453;
  const drop = (q - Math.floor(q)) > 0.86 ? 0.35 : 1;
  return Math.max(0, n) * drop;
}

/**
 * Great Lantern level, 0..1. 0 = the Great Lantern is out (dark glass, no point light / pool / embers,
 * street lamps guttering low, windows still lit, the town cold and moonlit). 1 = fully relit.
 * In between the lantern catches first (k 0..0.45) and the lamps follow at staggered thresholds by
 * distance from it (k 0.3..0.95). Cheap: scalar writes only, safe to call every frame.
 */
export function setLanternLevel(ctx, k) {
  LV.k = Math.min(1, Math.max(0, +k || 0));
  applyLevel(ctx, LV.t);
}
export function getLanternLevel() { return LV.k; }

function applyLevel(ctx, t) {
  const FX = ctx.lanternFx;
  if (!FX) return;
  const k = LV.k;
  const kl = sstep(0.0, 0.45, k);                         // the Great Lantern itself
  lanternLevelU.value = kl;
  FX.lanternFlicker.mul = kl * kl;
  for (const pl of FX.lanternPools) pl.mul = kl;
  FX.lanternHaze.strength = FX.lanternHaze.base * kl;
  for (const h of FX.lanternHalos) { h.material.color.copy(h.material.userData.base).multiplyScalar(kl); h.visible = kl > 0.002; }
  FX.lanternGlass.value = kl;
  let lampSum = 0, lampN = 0;
  for (const L of FX.lamps) {
    const on = sstep(L.thr, L.thr + 0.14, k);
    const g = 0.14 * gutter(t, L.seed);
    // ignition: a brief over-bright catch as the lamp lights
    const catchK = 1 + 0.35 * Math.max(0, 1 - Math.abs((k - L.thr - 0.07) / 0.07)) * (on > 0 && on < 1 ? 1 : 0);
    const lv = Math.min(1.35, (g + (1 - g) * on) * catchK);
    L.level = lv;
    L.pool.mul = lv;
    L.haze.strength = L.haze.base * lv;
    for (const h of L.halos) h.material.color.copy(h.material.userData.base).multiplyScalar(lv);
    if (L.cage) L.cage.value = lv;
    if (L.lamp.sprite && L.lamp.sprite.userData.size) { lampSum += lv; lampN++; }
  }
  FX.lampGlass.value = lampN ? lampSum / lampN : kl;
  if (FX.bulbs) FX.bulbs.mat.color.copy(FX.bulbs.base).multiplyScalar(0.03 + 0.97 * sstep(0.2, 0.7, k));
  // the town without its lantern: the moon takes over, a touch brighter and colder
  if (ctx.moon) ctx.moon.intensity = FX.moonBase * (1 + 0.45 * (1 - kl));
  if (ctx.hemi) ctx.hemi.intensity = FX.hemiBase * (1 + 0.25 * (1 - kl));
  for (const c of FX.chars) applyChar(c, k);
  if (ctx.daisWarm) ctx.daisWarm.value.copy(ctx.daisWarm.userData.base).multiplyScalar(kl);
}

function addPool(ctx, pos, color, intensity, radius, core, prio, seed = null) {
  const pl = { pos: pos.clone(), color: color.clone(), intensity, radius, core, prio, seed, weight: intensity * radius };
  // view-independent ordering: favour pools near the plaza
  pl.weight /= 1 + Math.hypot(pos.x, pos.z + 1) * 0.08;
  ctx.pools.push(pl);
  return pl;
}

let haloMats = new Map();
export function halo(ctx, pos, color, size, intensity, own = false) {
  const key = color.getHexString() + intensity.toFixed(2);
  let m = own ? null : haloMats.get(key);
  if (own) {
    m = new THREE.SpriteMaterial({ map: radialTex(), color: color.clone().multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    m.userData.base = m.color.clone();
  } else if (!m) {
    m = new THREE.SpriteMaterial({ map: radialTex(), color: color.clone().multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    haloMats.set(key, m);
  }
  const s = new THREE.Sprite(m);
  s.position.copy(pos);
  s.scale.set(size, size, 1);
  s.renderOrder = 10;
  ctx.scene.add(s);
  return s;
}

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _sphere = new THREE.Sphere();
export function updateLighting(ctx, t) {
  LV.t = t;
  applyLevel(ctx, t);
  for (const f of ctx.flicker) {
    const n = Math.sin(t * 7.1 + f.seed * 13) * 0.5 + Math.sin(t * 13.7 + f.seed * 5) * 0.3 + Math.sin(t * 2.3 + f.seed) * 0.2;
    f.light.intensity = f.base * (1 + 0.05 * n) * (f.mul ?? 1);
  }
  const cam = ctx.camera;
  if (!cam || !ctx.pools) return;
  cam.updateMatrixWorld();
  const P = poolU.uPoolPos.value, C = poolU.uPoolCol.value;
  _frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  let n = 0;
  for (const pl of ctx.pools) {
    if (n >= POOL_MAX) break;
    _sphere.center.copy(pl.pos); _sphere.radius = pl.radius;
    if (!_frustum.intersectsSphere(_sphere)) continue;
    _v.copy(pl.pos).applyMatrix4(cam.matrixWorldInverse);
    P[n].set(_v.x, _v.y, _v.z, pl.radius * pl.radius);
    let k = pl.intensity * (pl.mul ?? 1);
    if (k <= 1e-4) continue;
    if (pl.seed !== null) k *= 1 + 0.06 * (Math.sin(t * 7.1 + pl.seed * 13) * 0.6 + Math.sin(t * 12.3 + pl.seed * 3) * 0.4);
    C[n].set(pl.color.r * k, pl.color.g * k, pl.color.b * k, pl.core);
    n++;
  }
  poolU.uPoolCount.value = n;
}
