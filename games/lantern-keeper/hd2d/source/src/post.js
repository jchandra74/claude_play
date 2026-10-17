// Post-processing pipeline (all HDR, half-float):
//  1. scene -> rtScene (MSAA on high) with depth texture
//  2. prep (full res): analytic volumetric in-scatter haze around lights + signed circle-of-confusion
//  3. half-res downsample -> scatter-as-gather bokeh DOF (golden-angle spiral)
//  4. combine sharp/blurred by CoC, then particles are drawn on top as per-particle bokeh discs
//  5. bloom (13-tap down / tent up mip chain)
//  6. final: exposure, filmic tonemap, grade, chromatic aberration, vignette, grain -> sRGB
import * as THREE from 'three';
import { carryHaze, stageU } from './lighting.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = `
uniform float uNear, uFar, uFocus, uRange, uAperture, uMaxCoc, uFarK;
float viewDepth(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
float cocOf(float depth){
  float dd = depth - uFocus;
  // smooth focal band: ~0 inside +-range, then grows like a thin lens (|d-f|/d) on both sides
  float f = dd - uRange * tanh(dd / uRange);
  // the far field is held back (uFarK): background roofs / timber keep their texel pattern under the
  // tilt-shift instead of melting into slabs; the near field keeps the full aperture
  f *= dd > 0.0 ? mix(uFarK, 1.0, smoothstep(uFocus + 26.0, uFocus + 70.0, depth)) : 1.0;
  return clamp(f * uAperture / depth, -uMaxCoc, uMaxCoc);
}`;

const MAX_HAZE = 12;

const PREP_FS = `
${COMMON}
uniform sampler2D tColor, tDepth;
uniform mat4 uProjInv, uViewInv;
uniform vec3 uCamPos;
uniform vec4 uHazePos[${MAX_HAZE}];
uniform vec3 uHazeCol[${MAX_HAZE}];
uniform int uHazeCount;
uniform float uHazeDensity;
uniform vec3 uMistColor;
uniform float uMist;
varying vec2 vUv;
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  float depth = viewDepth(d);
  // the sky dome (r = 500) writes depth, so 'sky' is anything past the farthest ridgeline
  float isSky = step(400.0, depth) + step(0.99999, d);
  isSky = min(isSky, 1.0);
  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * ndc; vp /= vp.w;
  vec3 wp = (uViewInv * vp).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(wp - ro);
  float L = isSky > 0.5 ? 400.0 : length(wp - ro);
  vec3 haze = vec3(0.0);
  for (int i = 0; i < ${MAX_HAZE}; i++) {
    if (i >= uHazeCount) break;
    vec3 h = ro - uHazePos[i].xyz;
    float b = dot(rd, h);
    float c = dot(h, h) - b * b;
    float s = sqrt(max(c, 0.5));
    float I = (atan((L + b) / s) - atan(b / s)) / s;
    // keep the glow a local cone round each light (a long 1/s tail would wash the whole frame warm)
    float R = 2.0 + 6.0 * uHazePos[i].w;
    haze += uHazeCol[i] * uHazePos[i].w * I * (0.12 + 0.88 * exp(-c / (R * R)));
  }
  col += haze * uHazeDensity;
  // low ground mist: thicker in the low tiers, catches the cool moonlight
  float mistH = clamp(1.0 - (wp.y + 1.5) / 4.0, 0.0, 1.0);
  // mist builds up beyond the focal plane (the camera may sit far from the subject on a low tilt)
  float far = 1.0 - exp(-max(L - uFocus * 0.6, 0.0) * 0.02);
  float skyW = isSky > 0.5 ? exp(-max(rd.y, 0.0) * 14.0) : 1.0;   // only a thin luminous band on the horizon
  col += uMistColor * uMist * (mistH * mistH + 0.35) * far * skyW;
  // moonlit air: distant layers recede into luminous blue rather than mud, one step per depth band
  float air = smoothstep(uFocus + 8.0, uFocus + 70.0, L) * (1.0 - isSky);
  col = mix(col, col * vec3(0.6, 0.78, 1.05) + uMistColor * 1.2, air * 0.5);
  // the sky is a painted backdrop at infinity: keep the moon's rim and the stars crisp
  // the sky blurs like the ridges down at the ridgeline (so silhouettes melt into it) but stays crisp
  // above it, where the moon's limb, its halo and the stars must read as sharp as Octopath's backdrops
  float coc = isSky > 0.5 ? mix(uMaxCoc * 0.6, 1.4, smoothstep(0.105, 0.14, rd.y)) : cocOf(depth);
  gl_FragColor = vec4(col, coc);
}`;

const DOWN_FS = `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec4 a = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5));
  vec4 b = texture2D(tSrc, vUv + uTexel * vec2( 0.5, -0.5));
  vec4 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5,  0.5));
  vec4 d = texture2D(tSrc, vUv + uTexel * vec2( 0.5,  0.5));
  // CoC: prefer the nearest (most negative) to keep foreground edges
  float coc = min(min(a.a, b.a), min(c.a, d.a));
  float cocAvg = (a.a + b.a + c.a + d.a) * 0.25;
  coc = coc < -1.0 ? coc : cocAvg;
  gl_FragColor = vec4((a.rgb + b.rgb + c.rgb + d.rgb) * 0.25, coc);
}`;

// Two-layer gather. Far field: scatter-as-gather with a running mean (sharper midground is not
// overrun by blurrier background). Near field: every in-front-of-focus sample is spread over its own
// CoC disc with energy 1/(pi R^2), which gives a physically sized coverage alpha; near objects
// therefore go soft on BOTH sides of their silhouette instead of keeping a hard cut-out edge.
const GATHER_FS = `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uMaxR, uRadScale; varying vec2 vUv;
void main(){
  vec4 c0 = texture2D(tSrc, vUv);
  float cCoc = c0.a * 0.5;           // half-res pixels
  float cSize = abs(cCoc);
  float cNear = step(cCoc, -1.0);
  vec3 farSum = c0.rgb * (1.0 - cNear); float farN = 1.0 - cNear;
  float w0 = cNear / max(cSize * cSize, 1.0);
  vec3 nearSum = c0.rgb * w0; float nearW = w0;
  float farCap = mix(cSize * 2.0 + 0.5, 1e4, cNear);
  float radius = sqrt(2.0 * uRadScale), ang = 2.39996323, tot = 1.0;
  for (int i = 0; i < 400; i++) {
    if (radius > uMaxR) break;
    vec4 s = texture2D(tSrc, vUv + vec2(cos(ang), sin(ang)) * uTexel * radius);
    float sCoc = s.a * 0.5;
    float sSize = abs(sCoc);
    float isNear = step(sCoc, -1.0);
    vec3 sc = s.rgb * (1.0 + 0.6 * smoothstep(1.0, 4.0, dot(s.rgb, vec3(0.33))));
    // near layer: each near sample spread over its own CoC disc
    float mN = smoothstep(radius - 0.75, radius + 0.25, sSize) * isNear;
    float w = mN / max(sSize * sSize, 1.0);
    nearSum += sc * w; nearW += w;
    // far layer: scatter-as-gather with running mean
    float sz = sCoc > cCoc ? min(sSize, farCap) : sSize;
    float mF = max(smoothstep(radius - 0.75, radius + 0.25, sz), cNear);
    vec3 mean = farN > 0.0 ? farSum / farN : sc;
    float fw = 1.0 - isNear;
    farSum += mix(mean, sc, mF) * fw; farN += fw;
    tot += 1.0;
    ang += 2.39996323;
    radius = sqrt(tot * 2.0 * uRadScale);
  }
  vec3 nearC = nearW > 0.0 ? nearSum / nearW : c0.rgb;
  vec3 farC = farN > 0.0 ? farSum / farN : nearC;
  float cov = clamp(nearW * 2.0 * uRadScale, 0.0, 1.0);
  cov = smoothstep(0.0, 1.0, cov);
  gl_FragColor = vec4(mix(farC, nearC, cov), cov);
}`;

const COMBINE_FS = `
uniform sampler2D tSharp, tBlur; varying vec2 vUv;
void main(){
  vec4 s = texture2D(tSharp, vUv);
  vec4 b = texture2D(tBlur, vUv);
  // small far-field CoC stays on the full-res sharp image (the half-res blur would erase 1-px texels);
  // near-field blur keeps the original quick ramp
  float a = s.a < 0.0 ? smoothstep(0.6, 2.6, -s.a) : smoothstep(1.8, 5.5, s.a);
  a = max(a, b.a);
  gl_FragColor = vec4(mix(s.rgb, b.rgb, a), 1.0);
}`;

const BLOOM_DOWN_FS = `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform int uFirst; varying vec2 vUv;
vec3 tap(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main(){
  vec3 a = tap(vec2(-2,-2)), b = tap(vec2(0,-2)), c = tap(vec2(2,-2));
  vec3 d = tap(vec2(-1,-1)), e = tap(vec2(1,-1));
  vec3 f = tap(vec2(-2,0)), g = tap(vec2(0,0)), h = tap(vec2(2,0));
  vec3 i = tap(vec2(-1,1)), j = tap(vec2(1,1));
  vec3 k = tap(vec2(-2,2)), l = tap(vec2(0,2)), m = tap(vec2(2,2));
  vec3 col = (d+e+i+j)*0.125 + (a+b+f+g)*0.03125 + (b+c+g+h)*0.03125 + (f+g+k+l)*0.03125 + (g+h+l+m)*0.03125;
  if (uFirst == 1) {
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + 0.5, 0.0, 1.0); soft = soft * soft * 0.5;
    float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
    col *= contrib;
    col = min(col, vec3(40.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const BLOOM_UP_FS = `
uniform sampler2D tSmall, tBase; uniform vec2 uTexel; uniform float uScatter; varying vec2 vUv;
void main(){
  vec3 s = vec3(0.0);
  s += texture2D(tSmall, vUv + uTexel * vec2(-1,-1)).rgb;
  s += texture2D(tSmall, vUv + uTexel * vec2( 0,-1)).rgb * 2.0;
  s += texture2D(tSmall, vUv + uTexel * vec2( 1,-1)).rgb;
  s += texture2D(tSmall, vUv + uTexel * vec2(-1, 0)).rgb * 2.0;
  s += texture2D(tSmall, vUv).rgb * 4.0;
  s += texture2D(tSmall, vUv + uTexel * vec2( 1, 0)).rgb * 2.0;
  s += texture2D(tSmall, vUv + uTexel * vec2(-1, 1)).rgb;
  s += texture2D(tSmall, vUv + uTexel * vec2( 0, 1)).rgb * 2.0;
  s += texture2D(tSmall, vUv + uTexel * vec2( 1, 1)).rgb;
  s /= 16.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s * uScatter, 1.0);
}`;

const FINAL_FS = `
uniform sampler2D tHDR, tBloom; uniform float uExposure, uBloom, uTime, uCA, uVignette, uContrast; uniform vec2 uRes; varying vec2 vUv;
vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
void main(){
  vec2 cc = vUv - 0.5;
  float r2 = dot(cc, cc);
  vec2 off = cc * r2 * uCA;
  vec3 col;
  col.r = texture2D(tHDR, vUv - off).r;
  col.g = texture2D(tHDR, vUv).g;
  col.b = texture2D(tHDR, vUv + off).b;
  vec3 bl = texture2D(tBloom, vUv).rgb;
  col += bl * uBloom;
  col *= uExposure;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // how much of this pixel is warm practical light (lamp pools) vs cool moonlight
  float warmth = clamp((col.r - col.b) / max(lum, 1e-3), 0.0, 1.5);
  float warmM = smoothstep(0.15, 0.8, warmth);
  // night grade, pre-tonemap: moonlit shadows / mids -> saturated blue-teal, warm pools untouched
  float shadowM = smoothstep(0.35, 0.0, lum) * (1.0 - 0.85 * warmM);
  col = mix(col, lum * vec3(0.26, 0.92, 1.9), shadowM * 0.5);
  // a deep blue floor (not black, not lifted grey-navy): Octopath's night blacks sit near RGB(4,8,18)
  col += vec3(0.0008, 0.0018, 0.0052) * (1.0 - smoothstep(0.0, 0.05, lum));
  // tonemap: ACES blended with a hue-preserving luminance curve so hot glass stays orange-gold
  // with a white core only at the very centre, instead of clipping to a flat white-yellow slab
  vec3 ta = aces(col);
  float tl = aces(vec3(lum)).r;
  vec3 th = col * (tl / max(lum, 1e-4));
  th = th / max(1.0, max(th.r, max(th.g, th.b)));
  col = mix(ta, th, 0.45 * smoothstep(0.1, 0.9, tl));
  // split tone: cool shadows, warm highlights
  float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.82, 0.98, 1.14), vec3(1.0), smoothstep(0.02, 0.35, l2) * (0.4 + 0.6 * warmM));
  col *= mix(vec3(1.0), vec3(1.08, 1.0, 0.86), smoothstep(0.3, 0.8, l2) * warmM);
  // saturation: strongest in the mids
  l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float satK = 1.0 + 0.36 * smoothstep(0.0, 0.12, l2) * (1.0 - smoothstep(0.55, 0.95, l2));
  col = mix(vec3(l2), col, satK);
  col = clamp(col, 0.0, 1.0);
  // contrast: a toe that pushes the darkest quarter down toward deep blue while the moonlit mids
  // and the warm pools keep their level, so the frame spans a real range instead of one navy band
  vec3 toe = col * col / (col + 0.045) * 1.045;
  col = mix(col, toe, uContrast);
  col = col * col * (3.0 - 2.0 * col) * 0.32 + col * 0.68;
  // vignette: the frame edges fall to deep blue-black (Octopath's tilt-shift diorama framing)
  float vr = length(cc * vec2(1.0, 0.82)) * 1.1;
  float v = smoothstep(0.92, 0.22, vr);
  col *= mix(vec3(1.0) - uVignette * vec3(1.0, 0.88, 0.62), vec3(1.0), v);
  // the foreground ledge melts into the frame edge on a soft ramp instead of ending in a hard band
  col *= mix(vec3(0.62, 0.7, 0.84), vec3(1.0), smoothstep(0.0, 0.14, vUv.y));
  col = clamp(col, 0.0, 1.0);
  col = toSRGB(col);
  col += (h12(vUv * uRes) - 0.5) * 0.016;
  gl_FragColor = vec4(col, 1.0);
}`;

function rt(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts,
  });
}

export class Pipeline {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.q = quality;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const common = { uFarK: { value: 0.5 }, uNear: { value: 0.1 }, uFar: { value: 800 }, uFocus: { value: 30 }, uRange: { value: 3 }, uAperture: { value: 60 }, uMaxCoc: { value: 24 } };
    this.common = common;
    const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.prep = mk(PREP_FS, {
      ...common, tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uHazePos: { value: Array.from({ length: MAX_HAZE }, () => new THREE.Vector4()) },
      uHazeCol: { value: Array.from({ length: MAX_HAZE }, () => new THREE.Vector3()) },
      uHazeCount: { value: 0 }, uHazeDensity: { value: 0.03 },
      uMistColor: { value: new THREE.Vector3(0.012, 0.035, 0.085) }, uMist: { value: 1.0 },
    });
    this.down = mk(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.gather = mk(GATHER_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxR: { value: 12 }, uRadScale: { value: quality.dofRadScale } });
    this.combine = mk(COMBINE_FS, { tSharp: { value: null }, tBlur: { value: null } });
    this.bDown = mk(BLOOM_DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.4 }, uFirst: { value: 0 } });
    this.bUp = mk(BLOOM_UP_FS, { tSmall: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.85 } });
    this.final = mk(FINAL_FS, {
      tHDR: { value: null }, tBloom: { value: null }, uExposure: { value: 1.22 }, uBloom: { value: 0.1 }, uTime: { value: 0 },
      uCA: { value: 0.006 }, uVignette: { value: 0.55 }, uContrast: { value: 1.0 }, uRes: { value: new THREE.Vector2() },
    });
    this.targets = [];
  }

  setSize(w, h) {
    for (const t of this.targets) t.dispose();
    this.w = w; this.h = h;
    const dt = new THREE.DepthTexture(w, h);
    dt.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples: this.q.msaa, depthBuffer: true, depthTexture: dt,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.rtPrep = rt(w, h);
    this.rtHalf = rt(w >> 1, h >> 1);
    this.rtGather = rt(w >> 1, h >> 1);
    this.rtComp = rt(w, h);
    this.bloomDown = []; this.bloomUp = [];
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < this.q.bloomLevels; i++) {
      this.bloomDown.push(rt(bw, bh)); this.bloomUp.push(rt(bw, bh));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    this.targets = [this.rtScene, this.rtPrep, this.rtHalf, this.rtGather, this.rtComp, ...this.bloomDown, ...this.bloomUp];
    const s = h / 1080;
    this.scale = s;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  setFocus(v) {
    const s = this.scale;
    this.common.uFocus.value = v.focus;
    this.common.uRange.value = v.range;
    this.common.uAperture.value = v.aperture * s;
    this.common.uMaxCoc.value = this.q.dofMaxCoc * s;
  }

  render(scene, camera, particles, ctx, t) {
    const r = this.renderer;
    const c = this.common;
    c.uNear.value = camera.near; c.uFar.value = camera.far;
    // 1. scene
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    // 2. prep
    const P = this.prep.uniforms;
    P.tColor.value = this.rtScene.texture;
    P.tDepth.value = this.rtScene.depthTexture;
    P.uProjInv.value.copy(camera.projectionMatrixInverse);
    P.uViewInv.value.copy(camera.matrixWorld);
    P.uCamPos.value.copy(camera.position);
    // carried lights (Pip's hand lantern) first, then the area's own lights
    const hl = ctx.hazeLights || [];
    let nh = 0;
    for (let j = 0; j < carryHaze.length + hl.length && nh < MAX_HAZE; j++) {
      const h = j < carryHaze.length ? carryHaze[j] : hl[j - carryHaze.length];
      if (!(h.strength > 1e-3)) continue;
      const fl = 1 + 0.05 * Math.sin(t * 6.3 + nh * 1.7);
      P.uHazePos.value[nh].set(h.pos.x, h.pos.y, h.pos.z, h.strength * fl);
      P.uHazeCol.value[nh].set(h.color.r, h.color.g, h.color.b);
      nh++;
    }
    P.uHazeCount.value = nh;
    this.pass(this.prep, this.rtPrep);
    // 3. DOF
    this.down.uniforms.tSrc.value = this.rtPrep.texture;
    this.down.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.down, this.rtHalf);
    const G = this.gather.uniforms;
    G.tSrc.value = this.rtHalf.texture;
    G.uTexel.value.set(1 / this.rtHalf.width, 1 / this.rtHalf.height);
    G.uMaxR.value = c.uMaxCoc.value * 0.5;
    this.pass(this.gather, this.rtGather);
    this.combine.uniforms.tSharp.value = this.rtPrep.texture;
    this.combine.uniforms.tBlur.value = this.rtGather.texture;
    this.pass(this.combine, this.rtComp);
    // 4. particles as bokeh sprites
    if (particles) {
      particles.setPostUniforms(this, camera);
      r.setRenderTarget(this.rtComp);
      const ac = r.autoClear; r.autoClear = false;
      r.render(particles.scene, camera);
      r.autoClear = ac;
    }
    // 5. bloom
    let src = this.rtComp;
    for (let i = 0; i < this.bloomDown.length; i++) {
      const B = this.bDown.uniforms;
      B.tSrc.value = src.texture;
      B.uTexel.value.set(1 / src.width, 1 / src.height);
      B.uFirst.value = i === 0 ? 1 : 0;
      this.pass(this.bDown, this.bloomDown[i]);
      src = this.bloomDown[i];
    }
    let small = this.bloomDown[this.bloomDown.length - 1];
    for (let i = this.bloomDown.length - 2; i >= 0; i--) {
      const U = this.bUp.uniforms;
      U.tSmall.value = small.texture;
      U.tBase.value = this.bloomDown[i].texture;
      U.uTexel.value.set(1 / small.width, 1 / small.height);
      this.pass(this.bUp, this.bloomUp[i]);
      small = this.bloomUp[i];
    }
    // 6. final
    const F = this.final.uniforms;
    F.tHDR.value = this.rtComp.texture;
    F.tBloom.value = small.texture;
    F.uTime.value = t % 10;
    F.uVignette.value = 0.55 + 0.25 * stageU.value;
    F.uRes.value.set(this.w, this.h);
    this.pass(this.final, null);
  }
}
