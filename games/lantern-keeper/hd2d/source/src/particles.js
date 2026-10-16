// Particles: a few fireflies low over the grass, sparse embers drifting up from the Great Lantern,
// faint golden motes and the odd chimney spark. Positions are analytic functions of time
// (deterministic). Drawn after the DOF pass: each point sizes itself to its own circle of confusion
// (only genuinely out-of-focus ones become bokeh discs), and visibility is decided once per particle
// from the scene depth at its centre, so a disc is either whole or hidden (no clipped half-moons).
import * as THREE from 'three';
import { GREAT_LANTERN_LIGHT, rng, plazaDist, groundAt } from './layout.js';
import { groundY } from './terrain.js';
import { quality } from './config.js';

const VS = `
attribute vec4 aSeed;      // random seeds
attribute vec3 aBase;      // base position
attribute vec4 aColor;     // rgb + intensity
attribute float aKind;     // 0 firefly, 1 ember, 2 mote, 3 spark
uniform float uTime, uProjScale, uFocus, uRange, uAperture, uMaxCoc;
uniform sampler2D tDepth; uniform float uNear, uFar; uniform vec2 uRes;
varying vec4 vColor; varying float vSoft;
float viewDepth(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
float cocOf(float depth){
  float dd = depth - uFocus;
  float f = sign(dd) * max(abs(dd) - uRange, 0.0);
  return clamp(f * uAperture / depth, -uMaxCoc, uMaxCoc);
}
void main(){
  vec3 p = aBase;
  float t = uTime;
  float size = 0.06;
  float inten = aColor.a;
  if (aKind < 0.5) {
    // firefly: lazy wandering + pulse
    p += vec3(sin(t * 0.35 * (0.6 + aSeed.x) + aSeed.y * 30.0) * 0.6,
              sin(t * 0.5 * (0.6 + aSeed.z) + aSeed.w * 20.0) * 0.2,
              cos(t * 0.3 * (0.6 + aSeed.y) + aSeed.x * 40.0) * 0.6);
    float pulse = 0.5 + 0.5 * sin(t * (0.8 + aSeed.z * 1.2) + aSeed.w * 60.0);
    inten *= 0.08 + 0.92 * pulse * pulse * pulse;
    size = 0.05;
  } else if (aKind < 1.5) {
    // ember: rises from the lantern cage, spirals, cools and fades
    float life = 7.0 + aSeed.x * 5.0;
    float cyc = t / life + aSeed.y;
    float age = fract(cyc);
    // only some cycles emit, so embers come one at a time rather than as a fountain
    float on = step(0.45, fract(sin(floor(cyc) * 12.9898 + aSeed.w * 78.233) * 43758.5453));
    float rise = age * (1.4 + aSeed.z * 1.6);
    float sw = 0.25 + age * (0.6 + aSeed.w * 0.8);
    p += vec3(sin(age * 5.0 + aSeed.y * 40.0) * 0.4 * sw + (aSeed.z - 0.5) * 1.6 * age + 0.5 * age * age,
              rise,
              cos(age * 4.0 + aSeed.x * 30.0) * 0.4 * sw + (aSeed.x - 0.5) * 1.2 * age);
    inten *= on * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.3, 0.9, age));
    inten *= 0.65 + 0.35 * sin(t * 13.0 + aSeed.w * 50.0);
    size = 0.035;
  } else if (aKind < 2.5) {
    // mote: slow drifting dust catching the light
    p += vec3(sin(t * 0.11 + aSeed.x * 20.0) * 0.9, sin(t * 0.17 + aSeed.y * 10.0) * 0.4 + sin(t * 0.05 + aSeed.w * 9.0) * 0.3, cos(t * 0.13 + aSeed.z * 30.0) * 0.9);
    inten *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 0.9 + aSeed.w * 30.0), 2.0);
    size = 0.025;
  } else {
    // chimney sparks
    float life = 3.0 + aSeed.x * 2.0;
    float age = fract(t / life + aSeed.y);
    p += vec3((aSeed.z - 0.5) * 0.8 * age + sin(age * 6.0 + aSeed.w * 9.0) * 0.2, age * 3.0, (aSeed.w - 0.5) * 0.5 * age);
    inten *= (1.0 - age) * smoothstep(0.0, 0.1, age);
    size = 0.035;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float coc = abs(cocOf(depth));
  float px = size * uProjScale / depth;
  // only near-foreground fireflies may open up into bokeh; everything at or behind the focal plane
  // stays a small glowing speck so it reads as air, not as a disc stuck on the object behind it
  float maxDisc = (aKind < 0.5 && depth < uFocus - uRange) ? 30.0 : 4.5;
  float disc = min(max(px, coc * 1.5) + 1.5, maxDisc);
  // energy: in-focus particles are tiny but bright; bokeh discs spread (conserve) their energy
  float k = (px + 1.5) / disc;
  vec4 clip = projectionMatrix * mv;
  // occlusion from the scene depth at the particle centre (one decision per disc)
  vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
  float occ = 0.0;
  if (clip.w > 0.0 && all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)))) {
    float sd = viewDepth(texture2D(tDepth, suv).x);
    occ = smoothstep(0.0, 0.5, sd - depth + 0.25);
  }
  // a speck sitting right on a surface (scene depth just behind it) reads as dust on the object: fade it
  if (clip.w > 0.0 && aKind > 0.5) {
    float sd2 = viewDepth(texture2D(tDepth, suv).x);
    occ *= smoothstep(0.25, 1.2, sd2 - depth);
  }
  // discs whose rim would leave the frame are faded instead of clipped by the screen edge
  vec2 pxPos = suv * uRes;
  float edge = min(min(pxPos.x, uRes.x - pxPos.x), min(pxPos.y, uRes.y - pxPos.y));
  occ *= smoothstep(0.0, disc * 0.5 + 2.0, edge);
  vColor = vec4(aColor.rgb * inten * occ * mix(k * k, 1.0, 0.03), 1.0);
  vSoft = clamp(coc / 6.0, 0.0, 1.0);
  gl_PointSize = occ > 0.003 && inten > 0.003 ? disc : 0.0;
  gl_Position = clip;
}`;

const FS = `
varying vec4 vColor; varying float vSoft;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  // sharp core when in focus, flat bokeh disc with a brighter rim when blurred
  float core = exp(-r * r * 6.0);
  float bokeh = smoothstep(1.0, 0.85, r) * (0.75 + 0.35 * smoothstep(0.55, 0.95, r));
  float a = mix(core, bokeh, vSoft);
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}`;

export function buildParticles(ctx) {
  const R = rng(9001);
  const k = quality.particles;
  const bases = [], seeds = [], colors = [], kinds = [];
  const add = (x, y, z, col, inten, kind) => {
    bases.push(x, y, z); seeds.push(R(), R(), R(), R()); colors.push(col[0], col[1], col[2], inten); kinds.push(kind);
  };
  // fireflies: few, low over grass and hedges, away from the open cobbles
  const nFF = Math.floor(46 * k);
  for (let i = 0, n = 0; i < nFF * 30 && n < nFF; i++) {
    const x = -22 + R() * 44, z = -24 + R() * 34;
    if (plazaDist(x, z) < 1.2 || groundAt(x, z)[0] < 0.5) continue;
    add(x, groundY(x, z) + 0.3 + R() * 1.3, z, R() < 0.25 ? [1.0, 0.85, 0.35] : [0.7, 1.0, 0.3], 3 + R() * 4, 0); n++;
  }
  // a handful in the near foreground grass: the only big soft bokeh, and dim
  for (let i = 0; i < Math.max(1, Math.floor(5 * k)); i++) {
    const x = (R() < 0.5 ? -1 : 1) * (5 + R() * 9), z = 9 + R() * 6;
    add(x, groundY(x, z) + 0.3 + R() * 0.8, z, [0.7, 1.0, 0.3], 3 + R() * 2, 0);
  }
  // embers: sparse, drifting up and away from the lantern cage
  const L = GREAT_LANTERN_LIGHT;
  for (let i = 0; i < Math.floor(26 * k) + 2; i++) {
    add(L.x + (R() - 0.5) * 0.6, L.y - 0.2 + R() * 0.5, L.z + (R() - 0.5) * 0.5, [1.0, 0.5 + R() * 0.2, 0.15], 16 + R() * 14, 1);
  }
  // motes: faint dust hanging in the lantern's light
  for (let i = 0; i < Math.floor(36 * k); i++) {
    const a = R() * Math.PI * 2, rr = 1 + Math.sqrt(R()) * 6;
    add(L.x + Math.cos(a) * rr, 0.6 + R() * 3.6, L.z + Math.sin(a) * rr * 0.8, [1.0, 0.8, 0.5], 1.5 + R() * 2.5, 2);
  }
  // chimney sparks
  for (const ch of ctx.chimneys || []) {
    const p = ch.local.clone(); ch.house.group.localToWorld(p);
    for (let i = 0; i < Math.max(1, Math.floor(4 * k)); i++) add(p.x + (R() - 0.5) * 0.3, p.y, p.z + (R() - 0.5) * 0.3, [1.0, 0.5, 0.15], 10 + R() * 8, 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bases, 3));
  geo.setAttribute('aBase', new THREE.Float32BufferAttribute(bases, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 4));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: {
      uTime: { value: 0 }, uProjScale: { value: 1000 }, uFocus: { value: 30 }, uRange: { value: 3 }, uAperture: { value: 60 }, uMaxCoc: { value: 24 },
      tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 800 },
    },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(pts);
  return {
    scene,
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
