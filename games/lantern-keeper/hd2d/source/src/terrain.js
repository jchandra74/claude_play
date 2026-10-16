// Terrain: tiered heightfield. Village tiers are held up by dressed stone retaining walls
// (battered face, coping stones, piers, base AO); outer tiers are natural rock cliffs.
// Stone stairs (z- or x-facing) with cheek walls, and a splat-mapped ground material
// (grass / cobble / dirt) with repeat-breaking and macro colour variation.
import * as THREE from 'three';
import { GRID, TIER, levelAt, groundAt, groundDetail, STAIRS, HOUSES, PROPS, houseLocal, noise2, hash2, wallStyle, rng, plazaDist } from './layout.js';
import { tileTex } from './assets.js';
import { worldUV, mergeGeos, heightAO } from './geom.js';

export const TEX_M = 2.0;       // metres per ground texture tile
const SPLAT_RES = 4;            // splat texels per metre
const RUN = 0.38, NSTEP = 4;    // stair run per step / steps per tier

let levels = null, NX = 0, NZ = 0;

export function cellLevel(ix, iz) {
  if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return -99;
  return levels[iz * NX + ix];
}

// distance along a stair's run from its top edge, or -1 when (x,z) is not on it
function stairRun(s, x, z) {
  if (s.axis === 'x') {
    if (Math.abs(z - s.z) >= s.w / 2) return -1;
    const d = (x - s.edge) * s.dir;
    return d > 0 && d < RUN * NSTEP ? d : -1;
  }
  if (Math.abs(x - s.x) >= s.w / 2) return -1;
  const d = (z - s.edge) * s.dir;
  return d > 0 && d < RUN * NSTEP ? d : -1;
}

export function groundY(x, z) {
  const ix = Math.floor(x - GRID.x0), iz = Math.floor(z - GRID.z0);
  const L = cellLevel(ix, iz);
  if (L === -99) return 0;
  for (const s of STAIRS) {
    const d = stairRun(s, x, z);
    if (d >= 0) {
      const k = Math.floor(d / RUN);
      return (s.low + 1) * TIER - Math.min(k, NSTEP) * TIER / NSTEP;
    }
  }
  return L * TIER;
}
export function levelAtCell(x, z) { return cellLevel(Math.floor(x - GRID.x0), Math.floor(z - GRID.z0)); }

function rockDisp(x, y, z, nx, nz, out) {
  // displacement along the face normal only (no shear), smooth so corners stay watertight
  const a = noise2(x * 1.3 + y * 2.1 + z * 0.7, z * 1.3 - y * 1.7 + x * 0.4);
  const c = noise2(x * 3.1 + 7 + z * 1.3, z * 3.1 + y * 3.3);
  const d = (a - 0.5) * 0.36 + (c - 0.5) * 0.14 + 0.05;
  out.set(nx * d, (c - 0.5) * 0.06, nz * d);
  return out;
}

function stairSkips(dir, ix, iz) {
  const x0 = GRID.x0 + ix, z0 = GRID.z0 + iz;
  for (const s of STAIRS) {
    if (s.axis === 'x') {
      const ex = dir === 'px' ? x0 + 1 : (dir === 'nx' ? x0 : null);
      if (ex === null || (dir === 'px') !== (s.dir > 0)) continue;
      if (Math.abs(ex - s.edge) < 0.01 && Math.abs(z0 + 0.5 - s.z) < s.w / 2) return true;
    } else {
      const ez = dir === 'pz' ? z0 + 1 : (dir === 'nz' ? z0 : null);
      if (ez === null || (dir === 'pz') !== (s.dir > 0)) continue;
      if (Math.abs(ez - s.edge) < 0.01 && Math.abs(x0 + 0.5 - s.x) < s.w / 2) return true;
    }
  }
  return false;
}

export function buildTerrain(ctx) {
  NX = GRID.x1 - GRID.x0; NZ = GRID.z1 - GRID.z0;
  levels = new Int8Array(NX * NZ);
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    levels[iz * NX + ix] = levelAt(GRID.x0 + ix + 0.5, GRID.z0 + iz + 0.5);
  }
  const lowQ = ctx.quality && ctx.quality.name === 'low';
  const group = new THREE.Group();

  // ---------- splat texture ----------
  const SW = NX * SPLAT_RES, SH = NZ * SPLAT_RES;
  const sdata = new Uint8Array(SW * SH * 4);
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
    const x = GRID.x0 + (i + 0.5) / SPLAT_RES, z = GRID.z0 + (j + 0.5) / SPLAT_RES;
    const g = groundAt(x, z);
    const o = (j * SW + i) * 4;
    sdata[o] = g[0] * 255; sdata[o + 1] = g[1] * 255; sdata[o + 2] = g[2] * 255;
    sdata[o + 3] = (noise2(x * 0.12, z * 0.12) * 0.6 + noise2(x * 0.5 + 9, z * 0.5) * 0.4) * 255;
  }
  const splat = new THREE.DataTexture(sdata, SW, SH, THREE.RGBAFormat);
  splat.magFilter = THREE.LinearFilter; splat.minFilter = THREE.LinearFilter;
  splat.needsUpdate = true;

  // ---------- detail splat: R moss-in-grout, G worn walking line, B puddle, A contact AO near walls ----------
  const ddata = new Uint8Array(SW * SH * 4);
  const DIRS = [];
  for (let k = 0; k < 12; k++) DIRS.push([Math.cos(k / 12 * Math.PI * 2), Math.sin(k / 12 * Math.PI * 2)]);
  const lvAt = (x, z) => cellLevel(Math.floor(x - GRID.x0), Math.floor(z - GRID.z0));
  const houseBox = HOUSES.map(h => ({ h, rx: h.w / 2 + 0.13, rz: h.d / 2 + 0.13, L: h.level }));
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
    const x = GRID.x0 + (i + 0.5) / SPLAT_RES, z = GRID.z0 + (j + 0.5) / SPLAT_RES;
    const o = (j * SW + i) * 4;
    const hl = lvAt(x, z);
    // distance to the nearest higher terrain cell (wall foot) or house wall on this level
    let dmin = 9;
    for (const r of [0.25, 0.5, 0.8, 1.15]) {
      if (r >= dmin) break;
      for (const [dx, dz] of DIRS) { const n = lvAt(x + dx * r, z + dz * r); if (n > hl && n !== -99) { dmin = r; break; } }
    }
    for (const b of houseBox) {
      if (b.L !== hl) continue;
      const [lx, lz] = houseLocal(b.h, x, z);
      const d = Math.max(Math.abs(lx) - b.rx, Math.abs(lz) - b.rz);
      if (d > -0.05 && d < dmin) dmin = Math.max(0, d);
    }
    const eao = Math.max(0, 1 - dmin / 1.1);
    const [moss, wear, pud] = groundDetail(x, z);
    ddata[o] = Math.min(1, moss + eao * 0.5) * 255; ddata[o + 1] = wear * 255; ddata[o + 2] = pud * 255; ddata[o + 3] = eao * eao * 255;
  }
  const detail = new THREE.DataTexture(ddata, SW, SH, THREE.RGBAFormat);
  detail.magFilter = THREE.LinearFilter; detail.minFilter = THREE.LinearFilter;
  detail.needsUpdate = true;

  const tg = tileTex('tex_grass'), tc = tileTex('tex_cobble'), td = tileTex('tex_dirt');
  const tsb = tileTex('tex_stonebrick');
  for (const t of [tg, tc, td]) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; }

  const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true });
  groundMat.customProgramCacheKey = () => 'ground-v3';
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tSplat: { value: splat }, tGrass: { value: tg }, tCobble: { value: tc }, tDirt: { value: td },
      tDetail: { value: detail }, tFlag: { value: tsb },
      uSplatOrigin: { value: new THREE.Vector2(GRID.x0, GRID.z0) },
      uSplatSize: { value: new THREE.Vector2(NX, NZ) },
      uTexM: { value: TEX_M },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform sampler2D tSplat, tGrass, tCobble, tDirt, tDetail, tFlag;
uniform vec2 uSplatOrigin, uSplatSize;
uniform float uTexM;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
float gPud = 0.0, gWear = 0.0, gWet = 0.0;
{
  float texPx = 128.0 / uTexM;
  vec2 wp = vWPos.xz;
  vec2 qp = (floor(wp * texPx) + 0.5) / texPx;
  float hn = h21(qp);
  vec2 suv = (qp - uSplatOrigin) / uSplatSize;
  vec4 sp = texture2D(tSplat, suv);
  vec4 dt = texture2D(tDetail, suv);
  vec3 w = sp.rgb + (vec3(hn, fract(hn * 3.71), fract(hn * 9.13)) - 0.5) * 0.42;
  vec3 sel = (w.g >= w.r && w.g >= w.b) ? vec3(0.,1.,0.) : ((w.b > w.r) ? vec3(0.,0.,1.) : vec3(1.,0.,0.));
  vec2 tuv = wp / uTexM;
  float m1 = vn(qp * 0.35), m2 = vn(qp * 0.11 + 17.0), m3 = vn(qp * 1.3 + 5.0);
  // grass: clumpy hue/brightness variation (dark lush clumps, dry yellow patches)
  vec3 cg = texture2D(tGrass, tuv).rgb;
  vec3 cg2 = texture2D(tGrass, tuv.yx * 0.77 + 0.31).rgb;
  cg = mix(cg, cg2, step(0.5, m2));
  cg *= vec3(0.78, 0.92, 0.80);
  cg *= mix(0.72, 1.12, m1);
  cg = mix(cg, cg * vec3(1.18, 1.05, 0.62), smoothstep(0.62, 0.85, m2) * 0.6);
  // cobbles: two offset/rotated samples swapped by noise -> no visible repeat
  float cs = mix(1.15, 0.95, step(0.62, vn(qp * 0.09 + 41.0)));
  vec3 cc1 = texture2D(tCobble, tuv * cs).rgb;
  vec3 cc2 = texture2D(tCobble, vec2(-tuv.y, tuv.x) * cs + 0.43).rgb;
  vec3 cc = mix(cc1, cc2, step(0.5, vn(qp * 0.45 + 3.0)));
  // flagstone ring of dressed stones laid round the Great Lantern's dais (polar-mapped bricks)
  vec2 lq = qp - vec2(0.0, -1.2);
  float lr = length(lq);
  float ring = step(2.45, lr) * step(lr, 3.78) * sel.g;
  if (ring > 0.5) {
    float ang = atan(lq.y, lq.x);
    vec2 fuv = vec2(ang * 3.2 / 1.5, (lr - 2.45) / 1.5 + 0.13);
    cc = texture2D(tFlag, fuv).rgb * vec3(1.06, 1.0, 0.92);
    cc *= 1.0 - 0.45 * step(3.66, lr);
  }
  float lum = dot(cc, vec3(0.3, 0.55, 0.15));
  float grout = (1.0 - smoothstep(0.17, 0.27, lum)) * (1.0 - ring);
  cc *= mix(0.78, 1.1, m3) * mix(0.86, 1.06, m2);
  cc = mix(cc, cc * vec3(1.08, 0.98, 0.86), smoothstep(0.55, 0.8, m1) * 0.5);
  // worn walking lines: polished, paler stone tops, shallower grout
  gWear = dt.g * (1.0 - ring * 0.5);
  cc = mix(cc, cc * vec3(1.16, 1.12, 1.04) + vec3(0.015), gWear * (1.0 - grout) * 0.8);
  // moss in the grout (and whole mossy stones where it is thick)
  float mossK = smoothstep(0.25, 0.65, dt.r + (hn - 0.5) * 0.35);
  vec3 mossC = vec3(0.21, 0.33, 0.12) * (0.8 + 0.5 * m3);
  cc = mix(cc, mossC * (0.9 + lum), grout * mossK * 0.95);
  cc = mix(cc, cc * vec3(0.78, 1.0, 0.62), smoothstep(0.7, 1.0, dt.r + (m1 - 0.5) * 0.3) * 0.55);
  vec3 cd = texture2D(tDirt, tuv + 0.37).rgb;
  cd *= mix(0.8, 1.08, m3);
  cd = mix(cd, cd * vec3(0.72, 0.85, 0.55), smoothstep(0.55, 0.9, dt.r) * 0.5);
  vec3 col = cg * sel.r + cc * sel.g + cd * sel.b;
  col *= mix(0.78, 1.08, sp.a);
  // contact darkening at wall feet / house plinths: grout blackens first
  float eao = dt.a;
  col *= 1.0 - eao * (0.38 + 0.4 * grout * sel.g);
  // puddles: pixel-stepped edge, a darker wet rim, glossy dark water
  float pz = dt.b + (hn - 0.5) * 0.18;
  gPud = step(0.5, pz);
  gWet = smoothstep(0.12, 0.5, pz);
  col *= 1.0 - gWet * 0.28;
  col = mix(col, col * 0.22 + vec3(0.006, 0.009, 0.016), gPud);
  diffuseColor.rgb *= col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.5, gWet * 0.7);
  roughnessFactor = mix(roughnessFactor, 0.7, gPud);
  roughnessFactor = mix(roughnessFactor, 0.62, gWear * 0.6);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    // puddles mirror the night sky and, near the plaza, the Great Lantern's glow
    vec2 dl = vWPos.xz - vec2(0.0, -1.2);
    float lg = exp(-dot(dl, dl) / 26.0);
    float ripple = 0.75 + 0.25 * h21(floor(vWPos.xz * 28.0));
    totalEmissiveRadiance += gPud * ripple * (vec3(0.003, 0.006, 0.014) + vec3(1.0, 0.56, 0.2) * 0.05 * lg);
  }`);
  };

  // ---------- top surfaces ----------
  const pos = [], nor = [], col = [], idx = [];
  let vi = 0;
  const L = (ix, iz) => cellLevel(ix, iz);
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const h = L(ix, iz);
    const y = h * TIER;
    const x0 = GRID.x0 + ix, z0 = GRID.z0 + iz;
    // corner AO from higher neighbours (contact shadow at wall bases)
    for (const [cx, cz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      let occ = 0;
      for (const [dx, dz] of [[cx - 1, cz - 1], [cx, cz - 1], [cx - 1, cz], [cx, cz]]) {
        const n = L(ix + dx, iz + dz);
        if (n > h && n !== -99) occ++;
      }
      const ao = 1 - occ * 0.24;
      pos.push(x0 + cx, y, z0 + cz); nor.push(0, 1, 0); col.push(ao, ao, ao);
    }
    idx.push(vi, vi + 3, vi + 2, vi, vi + 2, vi + 1);
    vi += 4;
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  topGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  topGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  topGeo.setIndex(idx);
  const top = new THREE.Mesh(topGeo, groundMat);
  top.receiveShadow = true;
  group.add(top);

  // ---------- cliff faces: rock and dressed stone walls ----------
  const rock = { p: [], n: [], c: [], u: [], t: [], i: [], v: 0 };
  const wall = { p: [], n: [], c: [], u: [], t: [], i: [], v: 0 };
  const fringeQ = [], ivyQ = [];
  const RW = rng(9137);
  const coping = [];
  const tmp = new THREE.Vector3();
  function face(B, ax, az, bx, bz, nx, nz, yLo, yHi, isWall) {
    const SUBX = isWall ? 1 : 4;
    const rows = isWall ? 3 : Math.max(1, Math.round((yHi - yLo) / TIER) * 4);
    const base = B.v;
    const batter = 0.07;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows; const y = yLo + (yHi - yLo) * t;
      for (let c = 0; c <= SUBX; c++) {
        const s = c / SUBX;
        const x = ax + (bx - ax) * s, z = az + (bz - az) * s;
        let px = x, py = y, pz = z;
        if (isWall) {
          // battered: the face leans back toward the terrace by `batter` per tier
          const k = (yHi - y) / TIER * batter;
          px += nx * k; pz += nz * k;
        } else if (r > 0 && r < rows) {
          rockDisp(x, y, z, nx, nz, tmp);
          px += tmp.x; py += tmp.y; pz += tmp.z;
        }
        B.p.push(px, py, pz);
        B.n.push(nx, isWall ? 0.07 : 0, nz);
        // AO: dark foot, a little damp streaking from hash per column
        const streak = isWall ? 0.88 + 0.12 * hash2(Math.round(x * 2), Math.round(z * 2) + 3) : 1;
        const ao = (isWall ? 0.5 + 0.5 * Math.pow(t, 0.55) : 0.6 + 0.4 * Math.pow(t, 0.6)) * streak;
        B.c.push(ao, ao * (isWall ? 0.98 : 1), ao * (isWall ? 0.95 : 1.04));
        const u = (nx !== 0 ? z * -nx : x * nz);
        B.u.push(u / (isWall ? 1.6 : 2.2), y / (isWall ? 1.6 : 2.2));
        B.t.push(yHi - y);
        B.v++;
      }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < SUBX; c++) {
      const a = base + r * (SUBX + 1) + c, b = a + 1, d = a + SUBX + 1, e = d + 1;
      B.i.push(a, b, e, a, e, d);
    }
  }
  const pierAt = [];
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const h = L(ix, iz); const x0 = GRID.x0 + ix, z0 = GRID.z0 + iz;
    const yH = h * TIER;
    const nb = [
      ['pz', L(ix, iz + 1), x0, z0 + 1, x0 + 1, z0 + 1, 0, 1],
      ['nz', L(ix, iz - 1), x0 + 1, z0, x0, z0, 0, -1],
      ['px', L(ix + 1, iz), x0 + 1, z0 + 1, x0 + 1, z0, 1, 0],
      ['nx', L(ix - 1, iz), x0, z0, x0, z0 + 1, -1, 0],
    ];
    for (const [dir, n, ax, az, bx, bz, nx, nz] of nb) {
      const lo = n === -99 ? h - 3 : n;
      if (lo >= h) continue;
      if (stairSkips(dir, ix, iz)) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const isWall = wallStyle(mx, mz) === 'wall';
      face(isWall ? wall : rock, ax, az, bx, bz, nx, nz, lo * TIER, yH, isWall);
      // grass lip hanging over the top edge where the terrace above is grassy; ivy curtains on some walls
      const gTop = groundAt(mx - nx * 0.4, mz - nz * 0.4);
      if (gTop[0] > 0.5 || (gTop[2] > 0.5 && RW() < 0.35)) fringeQ.push([ax, az, bx, bz, nx, nz, yH, isWall, RW()]);
      if (yH - lo * TIER >= TIER * 0.99 && RW() < (isWall ? 0.3 : 0.18)) ivyQ.push([ax, az, bx, bz, nx, nz, yH, Math.min(yH - lo * TIER, 0.55 + RW() * 1.1), isWall, RW()]);
      if (isWall) {
        // coping stone along the top edge, overhanging the face
        const len = 1.08;
        const g = new THREE.BoxGeometry(nx !== 0 ? 0.36 : len, 0.15, nx !== 0 ? len : 0.36);
        g.translate(mx - nx * 0.08, yH + 0.03, mz - nz * 0.08);
        coping.push(g);
        // occasional buttress pier
        if (false) pierAt.push([mx, mz, nx, nz, lo * TIER, yH]);
      }
    }
  }
  const mk = (B) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(B.t, 1));
    g.setIndex(B.i);
    return g;
  };
  const rockGeo = mk(rock); rockGeo.computeVertexNormals();
  const cliffTex = tileTex('tex_cliff');
  cliffTex.wrapS = cliffTex.wrapT = THREE.MirroredRepeatWrapping;
  const cliffMat = stoneWeather(new THREE.MeshStandardMaterial({ map: cliffTex, vertexColors: true, roughness: 0.95, color: new THREE.Color(1.45, 1.45, 1.55) }), 3, 3, 'cliff');
  const cliffs = new THREE.Mesh(rockGeo, cliffMat);
  cliffs.receiveShadow = true; cliffs.castShadow = true;
  group.add(cliffs);

  const stoneTex = tileTex('tex_stonebrick');
  const wallMat = stoneWeather(new THREE.MeshStandardMaterial({ map: stoneTex, vertexColors: true, roughness: 0.93, color: new THREE.Color(1.22, 1.14, 1.04) }), 4, 5, 'wall');
  const walls = new THREE.Mesh(mk(wall), wallMat);
  walls.receiveShadow = true; walls.castShadow = true;
  group.add(walls);

  // piers
  for (const [mx, mz, nx, nz, y0, y1] of pierAt) {
    const g = new THREE.BoxGeometry(nx !== 0 ? 0.3 : 0.5, y1 - y0 + 0.1, nx !== 0 ? 0.5 : 0.3, 1, 3, 1);
    g.translate(mx + nx * 0.1, (y0 + y1) / 2 + 0.05, mz + nz * 0.1);
    worldUV(g, 1.6); heightAO(g, y0, y1, 0.5);
    coping.push(g);
    const cap = new THREE.BoxGeometry(nx !== 0 ? 0.42 : 0.62, 0.14, nx !== 0 ? 0.62 : 0.42);
    cap.translate(mx + nx * 0.1, y1 + 0.17, mz + nz * 0.1);
    coping.push(cap);
  }
  for (const g of coping) { if (!g.attributes.color) { worldUV(g, 1.2); heightAO(g, -10, -9, 1); } }
  const copeMat = stoneWeather(new THREE.MeshStandardMaterial({ map: stoneTex, vertexColors: true, roughness: 0.9, color: new THREE.Color(1.42, 1.34, 1.22) }), 4, 5, 'cope', false);
  const cope = new THREE.Mesh(mergeGeos(coping, true), copeMat);
  cope.castShadow = true; cope.receiveShadow = true;
  group.add(cope);

  // ---------- stairs ----------
  const treadMat = new THREE.MeshStandardMaterial({ map: stoneTex, vertexColors: true, roughness: 0.9, color: new THREE.Color(1.3, 1.24, 1.15) });
  const stairGeos = [], treadGeos = [];
  for (const s of STAIRS) {
    const upper = (s.low + 1) * TIER, lowY = s.low * TIER;
    const parts = [];
    for (let k = 0; k < NSTEP; k++) {
      const topY = upper - k * TIER / NSTEP;
      const hgt = topY - lowY + 0.05;
      // riser block + slightly protruding tread slab (nosing) for a crisp shadow line per step
      const g = new THREE.BoxGeometry(s.w, hgt - 0.06, RUN, 1, 2, 1);
      g.translate(0, lowY - 0.05 + (hgt - 0.06) / 2, k * RUN + RUN / 2);
      parts.push([g, lowY, topY, 0.45]);
      const t = new THREE.BoxGeometry(s.w + 0.04, 0.09, RUN + 0.08);
      t.translate(0, topY - 0.035, k * RUN + RUN / 2 + 0.04);
      parts.push([t, topY - 0.2, topY, 0.85]);
    }
    for (const side of [-1, 1]) {
      // cheek wall that steps down with the flight (sloped top), plus a low end post
      const g = new THREE.BoxGeometry(0.34, TIER, NSTEP * RUN + 0.1, 1, 3, 1);
      const gp = g.attributes.position;
      for (let i = 0; i < gp.count; i++) if (gp.getY(i) > 0) gp.setY(i, gp.getY(i) + 0.06 - (gp.getZ(i) + (NSTEP * RUN + 0.1) / 2) / (NSTEP * RUN + 0.1) * TIER * 0.55);
      g.translate(side * (s.w / 2 + 0.17), lowY + TIER / 2 - 0.02, NSTEP * RUN / 2 + 0.05);
      g.computeVertexNormals();
      parts.push([g, lowY, upper, 0.5]);
      const post = new THREE.BoxGeometry(0.42, TIER * 0.55, 0.42, 1, 2, 1);
      post.translate(side * (s.w / 2 + 0.17), lowY + TIER * 0.27, NSTEP * RUN - 0.05);
      parts.push([post, lowY, lowY + TIER * 0.55, 0.5]);
    }
    for (const [g, y0, y1, aoBase] of parts) {
      // shade by face before orienting (local +z = downhill): pale treads, a bright lit nosing on each
      // tread slab, risers in shadow, darker cheek-wall sides -> the flight reads step by step
      heightAO(g, y0, y1, aoBase);
      const gn = g.attributes.normal, gc = g.attributes.color;
      const isTread = aoBase === 0.85, isCheek = aoBase === 0.5;
      for (let i = 0; i < gn.count; i++) {
        const ny = gn.getY(i), nz = gn.getZ(i), nxx = Math.abs(gn.getX(i));
        let k = 1;
        if (ny > 0.5) k = isTread ? 1.28 : (isCheek ? 1.2 : 1.0);
        else if (nz > 0.5) k = isTread ? 1.55 : (isCheek ? 0.8 : 0.5);
        else if (nxx > 0.5) k = isCheek ? 0.62 : 0.7;
        gc.setXYZ(i, gc.getX(i) * k, gc.getY(i) * k, gc.getZ(i) * k * (isTread && nz > 0.5 ? 0.92 : 1));
      }
      if (s.axis === 'x') { g.rotateY(s.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(s.edge, 0, s.z); }
      else { if (s.dir < 0) g.rotateY(Math.PI); g.translate(s.x, 0, s.edge); }
      worldUV(g, aoBase === 0.85 ? 0.62 : 1.2);
      (aoBase === 0.85 ? treadGeos : stairGeos).push(g);
    }
  }
  const stairs = new THREE.Mesh(mergeGeos(stairGeos, true), treadMat);
  stairs.castShadow = true; stairs.receiveShadow = true;
  group.add(stairs);
  // tread slabs: pale, smooth worn stone so each step reads as a lit line against the dark risers
  const slabMat = new THREE.MeshStandardMaterial({ map: slabTexture(), vertexColors: true, roughness: 0.8, color: new THREE.Color(0.86, 0.82, 0.76) });
  const treads = new THREE.Mesh(mergeGeos(treadGeos, true), slabMat);
  treads.castShadow = true; treads.receiveShadow = true;
  group.add(treads);

  buildFringe(group, fringeQ, ivyQ);
  buildDebris(group, lowQ);

  ctx.scene.add(group);
  return { group, groundMat };
}

// ---------- stone weathering: per-stone tone/hue jitter, moss creeping down from the top, drip streaks ----------
function stoneWeather(mat, cu, cv, key, useTop = true) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSW;\nvarying float vTopD;' + (useTop ? '\nattribute float aTop;' : ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTopD = ' + (useTop ? 'aTop' : '9.0') + ';');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSW; varying float vTopD;
float sh21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float svn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(sh21(i), sh21(i+vec2(1,0)), f.x), mix(sh21(i+vec2(0,1)), sh21(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
{
  float row = floor(vMapUv.y * ${cv.toFixed(1)});
  vec2 cell = vec2(floor(vMapUv.x * ${cu.toFixed(1)} + 0.5 * mod(row, 2.0)), row);
  float seg = floor((vSW.x + vSW.z) * 0.6);
  float j = sh21(cell + seg * 7.13), j2 = sh21(cell * 1.7 + seg + 3.1);
  vec3 tint = vec3(1.0);
  tint *= 0.8 + 0.34 * j;
  if (j2 > 0.82) tint *= vec3(1.1, 1.0, 0.86);
  else if (j2 < 0.14) tint *= vec3(0.86, 0.98, 0.8);
  float along = (vSW.x + vSW.z);
  float colN = svn(vec2(along * 2.2, 3.0));
  float px = floor(along * 28.0);
  // moss tongues hanging from the coping / lip, pixel-stepped
  float mossD = 0.12 + 0.5 * colN * colN + 0.25 * step(0.86, sh21(vec2(px, 1.0)));
  float moss = 1.0 - step(mossD, vTopD + 0.06 * sh21(vec2(px, floor(vTopD * 28.0))));
  // dark drip streaks below the lip
  float drip = step(0.9, sh21(vec2(floor(along * 14.0), 5.0))) * (1.0 - step(0.25 + 0.6 * sh21(vec2(floor(along * 14.0), 9.0)), vTopD));
  // low-frequency damp blotches
  float b = svn(vSW.xz * 0.7 + vSW.y * 0.9);
  tint *= 0.86 + 0.24 * b;
  diffuseColor.rgb *= tint * (1.0 - drip * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.82, 0.36) + vec3(0.0, 0.012, 0.0), moss * 0.85);
}
#endif`);
  };
  mat.customProgramCacheKey = () => 'stoneW-' + key;
  return mat;
}

function slabTexture() {
  const [c, g] = pixCanvas(32, 32), R = rng(404);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const v = 168 + R() * 16 - ((x * 3 + y * 5) % 11 === 0 ? 14 : 0);
    g.fillStyle = `rgb(${v | 0},${v * 0.96 | 0},${v * 0.88 | 0})`; g.fillRect(x, y, 1, 1);
  }
  // slab joints + a worn darker centre line + a few chips
  g.fillStyle = 'rgb(92,86,78)'; g.fillRect(0, 0, 32, 1); g.fillRect(13, 0, 1, 16); g.fillRect(27, 16, 1, 16); g.fillRect(0, 16, 32, 1);
  g.fillStyle = 'rgb(206,200,186)'; g.fillRect(0, 1, 32, 1); g.fillRect(0, 17, 32, 1);
  for (let k = 0; k < 8; k++) { g.fillStyle = 'rgb(120,112,100)'; g.fillRect((R() * 31) | 0, (R() * 31) | 0, 2, 1); }
  const t = pixTex(c); t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------- pixel-art grass lip + ivy curtains for the terrace walls ----------
function pixCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function pixTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function fringeTexture() {
  const W = 56, H = 20, [c, g] = pixCanvas(W, H), R = rng(71);
  const sh = ['#2c5226', '#3d6e2e', '#4f8a38', '#6fa646', '#94c05a'];
  for (let x = 0; x < W; x++) {
    const len = 4 + Math.floor(R() * 7) + (R() < 0.18 ? 6 : 0);
    for (let y = 0; y < len; y++) {
      const k = y < 2 ? 3 : (y > len - 3 ? 0 : (R() < 0.5 ? 1 : 2));
      g.fillStyle = sh[k]; g.fillRect(x, y, 1, 1);
    }
    if (R() < 0.1) { g.fillStyle = sh[4]; g.fillRect(x, 0, 1, 1); }
  }
  const fl = ['#f2e6a0', '#e8a0b8', '#b8d0ff', '#ffffff'];
  for (let k = 0; k < 6; k++) { g.fillStyle = fl[Math.floor(R() * 4)]; g.fillRect(Math.floor(R() * (W - 2)), 1 + Math.floor(R() * 3), 2, 1); }
  return pixTex(c);
}
function ivyTexture() {
  const W = 56, H = 64, [c, g] = pixCanvas(W, H), R = rng(733);
  const leaf = ['#1f3f22', '#2c5a2c', '#3f7a36', '#5c9a42', '#86b85a'];
  const strands = 7;
  for (let s = 0; s < strands; s++) {
    let x = 3 + R() * (W - 6);
    const len = H * (0.35 + R() * 0.65);
    for (let y = 0; y < len; y++) {
      x += (R() - 0.5) * 0.9;
      const xi = Math.round(x);
      g.fillStyle = '#3a2a1a'; g.fillRect(xi, y, 1, 1);
      if (R() < 0.55) {
        // leaf cluster: 2-3 px blob with a lit top-left pixel
        const lx = xi + (R() < 0.5 ? -2 : 1), sz = R() < 0.3 ? 3 : 2;
        g.fillStyle = leaf[1 + Math.floor(R() * 2)]; g.fillRect(lx, y, sz, sz);
        g.fillStyle = leaf[3 + Math.floor(R() * 2)]; g.fillRect(lx, y, 1, 1);
        g.fillStyle = leaf[0]; g.fillRect(lx + sz - 1, y + sz - 1, 1, 1);
      }
    }
  }
  // dense mat along the top
  for (let x = 0; x < W; x++) for (let y = 0; y < 6 + R() * 5; y++) if (R() < 0.8) { g.fillStyle = leaf[Math.min(4, Math.floor(R() * 4) + (y < 2 ? 1 : 0))]; g.fillRect(x, y, 1, 1); }
  return pixTex(c);
}
function quadPush(Q, a, b, c, d, nrm, uv) {
  const base = Q.p.length / 3;
  for (const v of [a, b, c, d]) { Q.p.push(...v); Q.n.push(...nrm); }
  Q.u.push(...uv);
  Q.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function quadMesh(Q, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Q.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Q.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(Q.u, 2));
  g.setIndex(Q.i);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}
function buildFringe(group, fringeQ, ivyQ) {
  const F = { p: [], n: [], u: [], i: [] }, V = { p: [], n: [], u: [], i: [] };
  for (const [ax, az, bx, bz, nx, nz, yH, isWall, r] of fringeQ) {
    const off = isWall ? 0.14 : 0.06, hh = 0.36;
    const top = yH + (isWall ? 0.12 : 0.04);
    const u0 = Math.floor(r * 4) * 0.25;
    const nrm = [nx * 0.45, 0.85, nz * 0.45];
    quadPush(F, [ax + nx * off, top - hh, az + nz * off], [bx + nx * off, top - hh, bz + nz * off],
      [bx + nx * off, top, bz + nz * off], [ax + nx * off, top, az + nz * off], nrm, [u0, 0, u0 + 1, 0, u0 + 1, 1, u0, 1]);
  }
  for (const [ax, az, bx, bz, nx, nz, yH, len, isWall, r] of ivyQ) {
    const hh = len * 1.15, top = yH + 0.08;
    const k0 = isWall ? 0.04 : 0.14, k1 = k0 + (isWall ? hh / TIER * 0.07 : 0.1);
    const vb = 1 - hh / 1.14;
    const flip = r < 0.5;
    const nrm = [nx * 0.8, 0.6, nz * 0.8];
    quadPush(V, [ax + nx * k1, top - hh, az + nz * k1], [bx + nx * k1, top - hh, bz + nz * k1],
      [bx + nx * k0, top, bz + nz * k0], [ax + nx * k0, top, az + nz * k0], nrm,
      flip ? [1, vb, 0, vb, 0, 1, 1, 1] : [0, vb, 1, vb, 1, 1, 0, 1]);
  }
  const fm = new THREE.MeshStandardMaterial({ map: fringeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const im = new THREE.MeshStandardMaterial({ map: ivyTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  if (F.p.length) group.add(quadMesh(F, fm));
  if (V.p.length) { const m = quadMesh(V, im); m.castShadow = true; group.add(m); }
}

// ---------- scattered ground debris: fallen leaves, straw, pebbles, weeds, petals, broken slats ----------
function debrisAtlas() {
  const S = 16, [c, g] = pixCanvas(S * 4, S * 4), R = rng(5150);
  const px = (cx, cy, x, y, col) => { if (x < 0 || y < 0 || x >= S || y >= S) return; g.fillStyle = col; g.fillRect(cx * S + x, cy * S + y, 1, 1); };
  const leafCols = [['#c8642a', '#e08a3a', '#8a3c1c'], ['#d8a83a', '#f0cc5a', '#9a6a20'], ['#8a5a2a', '#a8763a', '#5a3a1c'], ['#b8402a', '#d86040', '#7a2418']];
  for (let v = 0; v < 4; v++) {
    for (let k = 0; k < 3 + v; k++) {
      const x0 = 2 + Math.floor(R() * 10), y0 = 2 + Math.floor(R() * 10), [a, b, d] = leafCols[(v + k) % 4];
      px(v, 0, x0, y0, a); px(v, 0, x0 + 1, y0, b); px(v, 0, x0, y0 + 1, a); px(v, 0, x0 + 1, y0 + 1, d); px(v, 0, x0 + 2, y0 + 1, a); px(v, 0, x0 + 1, y0 + 2, d);
    }
  }
  // straw
  for (let v = 0; v < 2; v++) for (let k = 0; k < 9; k++) {
    let x = 2 + R() * 12, y = 2 + R() * 12; const dx = R() - 0.5, dy = R() - 0.5, l = 3 + R() * 5;
    for (let t = 0; t < l; t++) px(v, 1, Math.round(x + dx * t * 1.6), Math.round(y + dy * t * 1.6), t % 3 ? '#d8c070' : '#b09040');
  }
  // pebbles
  for (let v = 2; v < 4; v++) for (let k = 0; k < 6; k++) {
    const x = 2 + Math.floor(R() * 12), y = 2 + Math.floor(R() * 12), sz = R() < 0.4 ? 2 : 1;
    g.fillStyle = '#8a847a'; g.fillRect(v * S + x, S + y, sz, sz); px(v, 1, x, y, '#b8b2a6'); px(v, 1, x + sz, y + sz - 1, '#4a463e');
  }
  // weeds through the cracks
  for (let v = 0; v < 2; v++) for (let k = 0; k < 14; k++) {
    const x = 4 + Math.floor(R() * 8 + (R() - 0.5) * 4), y = 4 + Math.floor(R() * 8);
    px(v, 2, x, y, ['#3f7a36', '#5c9a42', '#86b85a'][k % 3]);
  }
  // petals
  for (let k = 0; k < 10; k++) px(2, 2, 2 + Math.floor(R() * 12), 2 + Math.floor(R() * 12), ['#f0a8c0', '#ffffff', '#f2e080'][k % 3]);
  // broken slats
  for (const [x, y, l] of [[2, 4, 9], [5, 9, 7]]) for (let t = 0; t < l; t++) { px(3, 2, x + t, y, '#8a6040'); px(3, 2, x + t, y + 1, '#5a3c26'); }
  // cabbage leaves / produce scraps
  for (let k = 0; k < 4; k++) { const x = 3 + Math.floor(R() * 9), y = 3 + Math.floor(R() * 9); px(0, 3, x, y, '#8ab84a'); px(0, 3, x + 1, y, '#a8d060'); px(0, 3, x, y + 1, '#5a8a30'); }
  // dark wet stain (dithered)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, (y - 7.5) * 1.4); if (d < 5 || (d < 7 && (x + y) % 2)) px(1, 3, x, y, '#1a1612'); }
  return pixTex(c);
}
function buildDebris(group, lowQ) {
  const tex = debrisAtlas();
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const R = rng(2468);
  const S = 16 / 56; // one 16px cell on the 56 px/m grid
  const oaks = PROPS.filter(p => p.type === 'oak');
  const hot = [[-4.5, -6.7, 2.2, 'straw'], [3.3, -7.4, 2.2, 'straw'], [6.3, 0.9, 1.6, 'straw'], [10.6, -1.6, 1.6, 'straw'], [-8.6, -4.0, 1.6, 'straw'], [9.5, -5.0, 1.4, 'straw']];
  const items = [];
  const N = lowQ ? 260 : 900;
  const inHouse = (x, z) => HOUSES.some(h => { const [lx, lz] = houseLocal(h, x, z); return Math.abs(lx) < h.w / 2 + 0.3 && Math.abs(lz) < h.d / 2 + 0.3; });
  for (let i = 0; i < N * 6 && items.length < N; i++) {
    const x = -24 + R() * 48, z = -26 + R() * 36;
    if (inHouse(x, z) || Math.hypot(x, z + 1.2) < 2.7) continue;
    const g = groundAt(x, z);
    let cell = -1;
    let nearOak = 99; for (const o of oaks) nearOak = Math.min(nearOak, Math.hypot(x - o.x, z - o.z));
    const hs = hot.find(h => Math.hypot(x - h[0], z - h[1]) < h[2]);
    const r = R();
    if (nearOak < 4.5 && r < 0.75) cell = Math.floor(R() * 4);
    else if (hs && r < 0.8) cell = R() < 0.75 ? 4 + Math.floor(R() * 2) : (R() < 0.5 ? 12 : 11);
    else if (g[1] > 0.5 && plazaDist(x, z) > 0.84 && r < 0.5) cell = r < 0.38 ? 8 + Math.floor(R() * 2) : Math.floor(R() * 4);
    else if (g[1] > 0.5) { if (r < 0.1) cell = Math.floor(R() * 4); else if (r < 0.28) cell = 8 + Math.floor(R() * 2); else if (r < 0.36) cell = 6 + Math.floor(R() * 2); else if (r < 0.4) cell = 10; }
    else if (g[2] > 0.5) { if (r < 0.4) cell = 6 + Math.floor(R() * 2); else if (r < 0.55) cell = 4; }
    if (cell < 0) continue;
    items.push([x, z, cell, Math.floor(R() * 4)]);
  }
  const geo = new THREE.PlaneGeometry(S, S);
  geo.rotateX(-Math.PI / 2);
  const uvA = new Float32Array(items.length * 2);
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const d = new THREE.Object3D();
  items.forEach(([x, z, cell, rot], i) => {
    d.position.set(x, groundY(x, z) + 0.012, z);
    d.rotation.set(0, rot * Math.PI / 2, 0);
    d.scale.setScalar(cell === 13 ? 2.2 : 1);
    d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    uvA[i * 2] = (cell % 4) / 4; uvA[i * 2 + 1] = 1 - (Math.floor(cell / 4) + 1) / 4;
  });
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(uvA, 2));
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell + uv * 0.25;');
  };
  mat.customProgramCacheKey = () => 'debris';
  im.receiveShadow = true;
  group.add(im);
}

export function isNearCliffTop(x, z) {
  const ix = Math.floor(x - GRID.x0), iz = Math.floor(z - GRID.z0);
  const h = cellLevel(ix, iz);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cellLevel(ix + dx, iz + dz) < h) return true;
  return false;
}
export function isNearCliffBase(x, z) {
  const ix = Math.floor(x - GRID.x0), iz = Math.floor(z - GRID.z0);
  const h = cellLevel(ix, iz);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = cellLevel(ix + dx, iz + dz); if (n > h && n !== -99) return true; }
  return false;
}
export { hash2 };
