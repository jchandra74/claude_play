// Actors: animated billboard characters / monsters for the playable demo.
// Each actor is a group at its feet: a lit sprite (frame-swapped walk cycles, mirrored for left),
// a dense pixel contact shadow, a soft pool, and a short silhouette shadow along the moonlight.
// The sprite material is the plaza's character shading (warm front fill + one-pixel rim toward the
// key light + cool moon top rim), with uniforms refreshed per frame from the nearest light, plus
// hit-flash and a dithered dissolve for battle.
import * as THREE from 'three';
import { frame } from './game_tex.js';
import { blobShadow, shadowMaterial } from './props.js';

const geoCache = new Map();
function spriteGeo(w, h) {
  const key = w.toFixed(4) + 'x' + h.toFixed(4);
  let g = geoCache.get(key);
  if (g) return g;
  g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2, 0);
  // bent normals: tilted toward camera + sky, fanned left/right so lights on either side read
  const pos = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i) / (w / 2);
    v.set(sx * 0.75, 0.8, 0.55).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  geoCache.set(key, g);
  return g;
}

let silGeo = null;
function silhouetteGeo() {
  if (silGeo) return silGeo;
  silGeo = new THREE.PlaneGeometry(1, 1);
  silGeo.translate(0, 0.5, 0);
  silGeo.rotateX(-Math.PI / 2);
  return silGeo;
}

function actorMaterial(f0, U, emissive) {
  const m = new THREE.MeshStandardMaterial({ map: f0.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  if (emissive) {
    m.emissiveMap = f0.emis; m.emissive = new THREE.Color(1, 0.8, 0.5); m.emissiveIntensity = emissive;
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uTexel, uRimDir; uniform vec3 uRimCol, uFill; uniform vec4 uFlash; uniform float uFade;')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (uFade > 0.0) {
          float hd = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          if (hd < uFade) discard;
        }`)
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
        col *= 1.0 / (1.0 + max(cl - 0.5, 0.0) * 0.9);
        col += uRimCol * rim * (0.18 + bl * 0.9);
        col += vec3(0.05, 0.08, 0.12) * topRim * (1.0 - rim);
        col = mix(col, uFlash.rgb, uFlash.a);
        outgoingLight = col;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'actor-rim' + (emissive ? '-emi' : '');
  return m;
}

// Light probe hook: the game sets this to return the strongest light near (x, z):
// { x, z, k (0..1), color (THREE.Color) }.
export const LIGHT = { probe: null, moonAng: 0 };

const _c = new THREE.Color();
export class Actor {
  /**
   * o: { anim: { down:[keys], up:[keys], right:[keys] } | { idle:[keys] }, h (m, height of the reference frame),
   *      ref (reference frame key), fps, shadow (contact radius scale), sil (silhouette shadow), emissive, ground(x,z) }
   */
  constructor(parent, o) {
    this.o = o;
    this.anim = o.anim;
    const first = (o.anim.down || o.anim.idle)[0];
    const ref = frame(o.ref || first);
    this.ppm = ref.h / o.h;
    this.fps = o.fps ?? 8;
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.dir = o.dir || 'down';
    this.ground = o.ground || (() => 0);
    this.lift = 0; this.ox = 0; this.oz = 0; this.tilt = 0; this.bob = 0;
    this.moving = false; this.animT = 0; this.frameKey = null; this.flip = false;
    this.forceFlip = o.flip || false;
    this.U = {
      uTexel: { value: new THREE.Vector2(1 / ref.w, 1 / ref.h) },
      uRimDir: { value: new THREE.Vector2(1, 1) },
      uRimCol: { value: new THREE.Color(0.4, 0.25, 0.1) },
      uFill: { value: new THREE.Color(0.1, 0.1, 0.12) },
      uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
      uFade: { value: 0 },
    };
    this.mat = actorMaterial(ref, this.U, o.emissive || 0);
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(spriteGeo(ref.w / this.ppm, ref.h / this.ppm), this.mat);
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.userData.sprite = first;
    this.group.add(this.mesh);
    const w = ref.w / this.ppm * (o.shadow ?? 1);
    this.w = ref.w / this.ppm; this.hgt = ref.h / this.ppm;
    this.blobA = blobShadow(0.03, 0, 0.07, Math.max(0.2, w * 0.42), Math.max(0.12, w * 0.22), 0.95);
    this.blobB = blobShadow(0.03, -0.003, 0.05, Math.max(0.3, w * 0.66), Math.max(0.18, w * 0.36), 0.5);
    this.group.add(this.blobA, this.blobB);
    if (o.sil !== false) {
      this.silMat = shadowMaterial(ref.tex, 0.62, false, 0.55);
      this.sil = new THREE.Mesh(silhouetteGeo(), this.silMat);
      this.sil.renderOrder = 2;
      this.sil.position.y = 0.025;
      this.group.add(this.sil);
    }
    parent.add(this.group);
    this.setFrame(first, false);
    this.sync();
  }

  get visible() { return this.group.visible; }
  set visible(v) { this.group.visible = v; }

  setFrame(key, flip) {
    if (key === this.frameKey && flip === this.flip) return;
    const f = frame(key);
    this.frameKey = key; this.flip = flip;
    const w = f.w / this.ppm, h = f.h / this.ppm;
    this.mesh.geometry = spriteGeo(w, h);
    this.mesh.scale.x = flip ? -1 : 1;
    this.mesh.userData.size = [w, h];
    if (this.mat.map !== f.tex) this.mat.map = f.tex;
    if (this.o.emissive && f.emis) this.mat.emissiveMap = f.emis;
    this.U.uTexel.value.set(1 / f.w, 1 / f.h);
    if (this.sil) {
      this.silMat.uniforms.map.value = f.tex;
      this.silMat.uniforms.uFlip.value = flip ? 1 : 0;
      this.sil.scale.set(w, 1, h * 0.6);
    }
  }

  // pick the frame for the current direction / movement
  animate(dt, speedMul = 1) {
    const a = this.anim;
    let list, flip = this.forceFlip;
    if (a.idle) list = a.idle;
    else {
      const d = this.dir;
      if (d === 'left') { list = a.left || a.right; flip = a.left ? this.forceFlip : !this.forceFlip; }
      else list = a[d] || a.down;
    }
    let i = 0;
    if (a.idle && a.loop) { this.animT += dt * this.fps * speedMul; i = Math.floor(this.animT) % list.length; }
    else if (this.moving && list.length > 1) { this.animT += dt * this.fps * speedMul; i = Math.floor(this.animT) % list.length; }
    else this.animT = 0;
    this.setFrame(list[i], flip);
  }

  sync() {
    const gy = this.ground(this.x, this.z);
    this.group.position.set(this.x + this.ox, gy, this.z + this.oz);
    this.mesh.position.y = this.lift + this.bob;
    this.mesh.rotation.z = this.tilt;
    const air = Math.min(1, (this.lift + this.bob) / 3);
    this.blobA.visible = this.blobB.visible = true;
    this.blobA.scale.setScalar(1 - air * 0.4); this.blobB.scale.setScalar(1 + air * 0.3);
    if (this.sil) { this.sil.rotation.y = LIGHT.moonAng; this.sil.visible = this.lift < 0.2 && this.tilt === 0; }
    // key light: warm fill + rim from the strongest nearby light
    const L = LIGHT.probe ? LIGHT.probe(this.x, this.z) : null;
    if (L) {
      const dx = L.x - this.x;
      const du = (Math.abs(dx) < 0.15 ? 0 : Math.sign(dx)) * (this.flip ? -1 : 1);
      this.U.uRimDir.value.set(du, 1);
      this.U.uRimCol.value.copy(L.color).multiplyScalar(L.k);
      _c.copy(L.color).multiplyScalar(0.2 * L.k);
      this.U.uFill.value.setRGB(_c.r + 0.1, _c.g + 0.1, _c.b + 0.12);
    }
  }

  update(dt, speedMul) { this.animate(dt, speedMul); this.sync(); }

  // world position of a point on the sprite (u: 0..1 across, v: 0..1 up)
  anchor(out, v = 0.5) {
    out.set(this.group.position.x, this.group.position.y + this.mesh.position.y + this.hgt * v, this.group.position.z);
    return out;
  }
}
