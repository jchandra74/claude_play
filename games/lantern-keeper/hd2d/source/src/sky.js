// Night sky dome: deep blue gradient, pixel stars, moon with halo, thin drifting clouds.
// Also a ring of distant dark hills so the diorama never ends in a void.
import * as THREE from 'three';
import { MOON_DIR } from './lighting.js';

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
  vec3 col = mix(vec3(0.05, 0.11, 0.22), vec3(0.006, 0.014, 0.05), smoothstep(0.0, 0.55, h));
  col += vec3(0.04, 0.09, 0.16) * exp(-max(h, 0.0) * 8.0);
  // stars
  vec3 g = floor(d * 260.0);
  float s = h3(g);
  float star = step(0.9965, s) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0));
  col += vec3(0.8, 0.85, 1.0) * star * 3.0 * smoothstep(0.02, 0.2, h);
  // moon
  float md = dot(d, normalize(uMoonDir));
  col += vec3(0.75, 0.85, 1.2) * smoothstep(0.9993, 0.9996, md) * 6.0;
  col += vec3(0.25, 0.35, 0.7) * pow(max(md, 0.0), 180.0) * 1.2 + vec3(0.06, 0.09, 0.2) * pow(max(md, 0.0), 12.0);
  // clouds
  vec2 cp = d.xz / max(d.y + 0.15, 0.05) * 1.3 + vec2(uTime * 0.01, 0.0);
  float c = smoothstep(0.5, 0.85, fbm(cp));
  col = mix(col, vec3(0.08, 0.11, 0.22) + vec3(0.12, 0.15, 0.3) * pow(max(md, 0.0), 8.0), c * 0.7 * smoothstep(-0.05, 0.15, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSky(ctx) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: true, fog: false,
    uniforms: { uMoonDir: { value: MOON_DIR.clone() }, uTime: { value: 0 } },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  ctx.scene.add(sky);

  // distant hills: dark silhouette ring
  const hills = new THREE.Group();
  const hmat = new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 1 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const g = new THREE.ConeGeometry(30 + (i % 3) * 8, 22 + (i * 7 % 5) * 4, 7);
    const m = new THREE.Mesh(g, hmat);
    m.position.set(Math.sin(a) * 120, 2, -Math.cos(a) * 120);
    hills.add(m);
  }
  ctx.scene.add(hills);
  return { update(t) { mat.uniforms.uTime.value = t; } };
}
