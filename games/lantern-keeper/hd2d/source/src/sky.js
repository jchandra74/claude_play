// Night sky dome: deep blue gradient, pixel stars, moon with halo, thin drifting clouds.
// Also a ring of distant dark hills so the diorama never ends in a void.
import * as THREE from 'three';
import { MOON_DIR } from './lighting.js';
import { quality } from './config.js';

// The visible moon sits low over the ridges (upper left of the hero frame); the moonlight keeps
// its own higher direction (MOON_DIR) so the shadows stay readable.
// The moon is committed to: a pale, slightly mottled disc with a tight bright corona and a wide soft
// halo, hung above the ridgeline in the upper left of the hero frame. Clouds are layered banks whose
// edges facing the moon pick up silver linings. Stars are tiny (1-2 px), varied, and crisp: the sky
// is exempt from the depth of field (post.js), so nothing in it turns into an unmotivated bokeh disc.
// The palette is a desaturated slate-navy rather than electric blue (the post grade adds the blue).
const SKY_MOON = new THREE.Vector3(-0.3, 0.172, -0.94).normalize();
const VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`;
const FS = `
varying vec3 vDir; uniform vec3 uMoonDir; uniform float uTime, uLan;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=h3(vec3(i,0.)), b=h3(vec3(i+vec2(1,0),0.)), c=h3(vec3(i+vec2(0,1),0.)), d=h3(vec3(i+vec2(1,1),0.));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<FBM_OCT;i++){ s+=a*n2(p); p*=2.03; a*=.5;} return s; }
float clouds(vec2 p){
  // stretched horizontal banks, broken up: thicker low over the ridges, thinning toward the zenith
  float c = fbm(p * vec2(0.55, 1.6)) * 0.75 + fbm(p * vec2(1.7, 3.2) + 7.3) * 0.35;
  return c;
}
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 M = normalize(uMoonDir);
  float md = dot(d, M);
  // slate night: muted blue-grey horizon falling to a deep ink zenith
  vec3 col = mix(vec3(0.075, 0.1, 0.145), vec3(0.01, 0.016, 0.036), smoothstep(0.0, 0.42, h));
  col += vec3(0.035, 0.05, 0.075) * exp(-max(h, 0.0) * 7.0);
  // moon glow: wide soft halo + tight corona (this is what lights the clouds)
  float glow = pow(max(md, 0.0), 900.0) * 0.9 + pow(max(md, 0.0), 120.0) * 0.28 + pow(max(md, 0.0), 14.0) * 0.07;
  col += vec3(0.42, 0.5, 0.66) * glow;
  // stars: fine grid, several brightness tiers, a few with a 1-px cross; hidden behind clouds
  vec3 g = floor(d * 1400.0);
  float s = h3(g);
  float tw = 0.7 + 0.3 * sin(uTime * (1.5 + s * 3.0) + s * 100.0);
  float star = step(0.9962, s) * (0.25 + 0.75 * h3(g + 3.1)) * tw;
  vec3 g2 = floor(d * 520.0);
  float s2 = h3(g2 + 17.0);
  float big = step(0.99935, s2) * tw;
  float starK = smoothstep(0.03, 0.16, h) * (1.0 - smoothstep(0.9965, 0.999, md));
  // moon disc: pale, slightly mottled maria, soft limb
  float disc = smoothstep(0.999800, 0.999835, md);
  vec2 mp = vec2(dot(d, normalize(cross(M, vec3(0,1,0)))), d.y - M.y) * 600.0;
  float maria = fbm(mp * 0.35 + 3.0);
  vec3 moonCol = mix(vec3(0.95, 0.98, 1.05), vec3(0.66, 0.72, 0.84), smoothstep(0.45, 0.7, maria)) * 2.6;
  moonCol *= 0.82 + 0.18 * smoothstep(0.999800, 0.99997, md);
  // clouds on a flat ceiling, drifting slowly
  vec2 cp = d.xz / max(d.y + 0.12, 0.05) * 1.1 + vec2(uTime * 0.006, 0.0);
  float cA = clouds(cp);
  float cB = clouds(cp + (M.xz / max(M.y + 0.12, 0.05) * 1.1 - cp) * 0.018);   // a step toward the moon
  float cov = smoothstep(0.52, 0.72, cA) * smoothstep(-0.03, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h) * 0.6);
  float rimL = clamp((cA - cB) * 6.0, 0.0, 1.0);                                   // edge facing the moon
  float nearMoon = pow(max(md, 0.0), 40.0) * 1.6 + pow(max(md, 0.0), 6.0) * 0.25;
  // moonlit cloud bodies sit a little above the sky value; darker cores, silver edges toward the moon
  vec3 cloudCol = col * 1.25 + vec3(0.025, 0.032, 0.048) - vec3(0.02, 0.022, 0.026) * smoothstep(0.62, 0.95, cA);
  cloudCol += vec3(0.42, 0.5, 0.66) * nearMoon * (0.25 + 1.3 * rimL);
  cloudCol += vec3(0.05, 0.06, 0.085) * rimL * 0.6;
  col += vec3(0.85, 0.9, 1.0) * (star * 2.4 + big * 4.0) * starK;
  col = mix(col, moonCol, disc);
  // thin veil can pass in front of the moon, thick bank cannot reach it (keeps the disc readable)
  col = mix(col, cloudCol, cov * 0.92 * (1.0 - disc * 0.75));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSky(ctx) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: '#define FBM_OCT ' + (quality.name === 'low' ? 3 : 5) + '\n' + FS, side: THREE.BackSide, depthWrite: true, fog: false,
    uniforms: { uMoonDir: { value: SKY_MOON.clone() }, uTime: { value: 0 }, uLan: { value: 1 } },
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
    { z: -62, y0: 4, amp: 5, pines: 3, top: [0.018, 0.034, 0.05], foot: [0.03, 0.06, 0.1], seed: 1, k: 0.0032 },
    { z: -95, y0: 7, amp: 6, pines: 3.5, top: [0.028, 0.05, 0.085], foot: [0.05, 0.1, 0.17], seed: 2, k: 0.0022 },
    { z: -160, y0: 12, amp: 12, pines: 0, top: [0.04, 0.07, 0.12], foot: [0.07, 0.13, 0.22], seed: 3, k: 0.0012 },
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
