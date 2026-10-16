// Night sky dome: deep blue gradient, pixel stars, moon with halo, thin drifting clouds.
// Also a ring of distant dark hills so the diorama never ends in a void.
import * as THREE from 'three';
import { MOON_DIR } from './lighting.js';

// The visible moon sits low over the ridges (upper left of the hero frame); the moonlight keeps
// its own higher direction (MOON_DIR) so the shadows stay readable.
const SKY_MOON = new THREE.Vector3(-0.3, 0.152, -0.94).normalize();
const VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`;
const FS = `
varying vec3 vDir; uniform vec3 uMoonDir; uniform float uTime;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=h3(vec3(i,0.)), b=h3(vec3(i+vec2(1,0),0.)), c=h3(vec3(i+vec2(0,1),0.)), d=h3(vec3(i+vec2(1,1),0.));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5;} return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  // Octopath night: luminous blue-teal horizon falling to a deep navy zenith
  vec3 col = mix(vec3(0.05, 0.11, 0.22), vec3(0.006, 0.014, 0.05), smoothstep(-0.02, 0.24, h));
  col += vec3(0.04, 0.09, 0.16) * exp(-max(h, 0.0) * 8.0);
  // stars
  vec3 g = floor(d * 260.0);
  float s = h3(g);
  float star = step(0.9965, s) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0));
  col += vec3(0.8, 0.85, 1.0) * star * 3.0 * smoothstep(0.02, 0.2, h);
  // moon
  float md = dot(d, normalize(uMoonDir));
  col += vec3(0.75, 0.85, 1.2) * smoothstep(0.99978, 0.99986, md) * 5.0;
  col += vec3(0.25, 0.35, 0.7) * pow(max(md, 0.0), 180.0) * 1.2 + vec3(0.04, 0.065, 0.15) * pow(max(md, 0.0), 16.0);
  // clouds
  vec2 cp = d.xz / max(d.y + 0.15, 0.05) * 1.3 + vec2(uTime * 0.01, 0.0);
  float c = smoothstep(0.5, 0.85, fbm(cp));
  col = mix(col, vec3(0.08, 0.11, 0.22) + vec3(0.12, 0.15, 0.3) * pow(max(md, 0.0), 8.0), c * 0.7 * smoothstep(-0.05, 0.15, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSky(ctx) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: true, fog: false,
    uniforms: { uMoonDir: { value: SKY_MOON.clone() }, uTime: { value: 0 } },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  ctx.scene.add(sky);

  // Distant layered ridgelines (Octopath stacks several silhouettes behind a town): each ridge is a
  // strip whose crest is rolling noise plus a saw of pine tips; nearer ridges are darker and greener,
  // farther ones lift toward the luminous horizon haze. Vertex colours fade the foot into mist.
  const ridges = new THREE.Group();
  const LAYERS = [
    // z (centre), base height, amplitude, pine tips, crest colour, foot (mist) colour, seed, curve
    { z: -62, y0: 10, amp: 5, pines: 3.5, top: [0.018, 0.034, 0.05], foot: [0.03, 0.06, 0.1], seed: 1, k: 0.0032 },
    { z: -95, y0: 14, amp: 9, pines: 4, top: [0.03, 0.055, 0.1], foot: [0.05, 0.1, 0.17], seed: 2, k: 0.0022 },
    { z: -160, y0: 18, amp: 20, pines: 0, top: [0.045, 0.085, 0.16], foot: [0.07, 0.13, 0.22], seed: 3, k: 0.0012 },
  ];
  const fbm1 = (x, sd) => { let v = 0, a = 1, f = 1; for (let o = 0; o < 4; o++) { v += a * Math.sin(x * 0.013 * f + sd * 3.1 + o * 1.7) * Math.cos(x * 0.0071 * f - sd + o); a *= 0.5; f *= 2.13; } return v; };
  const hsh = (n) => { const q = Math.sin(n * 91.7 + 13.1) * 43758.5; return q - Math.floor(q); };
  LAYERS.forEach((L, li) => {
    const pos = [], col = [], idx = [];
    const X0 = -330, X1 = 330, STEP = L.pines ? 1.1 : 4;
    let n = 0;
    for (let x = X0; x <= X1; x += STEP) {
      let top = L.y0 + fbm1(x, L.seed) * L.amp * 0.6 + L.amp * 0.4;
      if (L.pines) {
        // saw of pine tips: each ~2.2 m cell a triangular spike of random height
        const cell = Math.floor(x / 2.2), f = x / 2.2 - cell;
        const hgt = L.pines * (0.45 + hsh(cell + L.seed * 100) * 0.8);
        top += hgt * (1 - Math.abs(f - 0.5) * 2);
      }
      const z = L.z + x * x * L.k;
      pos.push(x, top, z, x, -8, z);
      col.push(...L.top, ...L.foot);
      if (n > 0) { const a = (n - 1) * 2, b = n * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -9 + li;
    m.frustumCulled = false;
    ridges.add(m);
  });
  ctx.scene.add(ridges);
  return { update(t) { mat.uniforms.uTime.value = t; } };
}
