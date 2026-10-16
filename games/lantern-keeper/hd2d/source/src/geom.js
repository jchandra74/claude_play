// Small geometry helpers shared by terrain and buildings.
import * as THREE from 'three';

// Box-projected UVs in metres (u,v = position / tile) chosen by dominant normal axis.
// offset lets callers align a texture (e.g. timber beams) to a given origin.
export function worldUV(geo, tileU, tileV = tileU, offset = [0, 0, 0]) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - offset[0], y = p.getY(i) - offset[1], z = p.getZ(i) - offset[2];
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x / tileU; v = z / tileV; }
    else if (ax >= az) { u = (n.getX(i) > 0 ? -z : z) / tileU; v = y / tileV; }
    else { u = (n.getZ(i) > 0 ? x : -x) / tileU; v = y / tileV; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Build a BufferGeometry from quads: each quad = 4 points [p0,p1,p2,p3] (CCW from outside) + uv rect.
export function quadsGeometry(quads) {
  const pos = [], uv = [], idx = [];
  let v = 0;
  for (const q of quads) {
    for (let k = 0; k < 4; k++) { pos.push(...q.p[k]); uv.push(...q.uv[k]); }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function triGeometry(pts, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.computeVertexNormals();
  return g;
}

// Concatenate geometries (indexed or not) that share position/normal/uv (+ optional color).
export function mergeGeos(geos, withColor = false) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let base = 0;
  for (let g of geos) {
    if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      if (withColor) col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (withColor) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

// Vertex-colour ambient occlusion by height: dark at the base, optional dark band at the top.
export function heightAO(geo, y0, y1, base = 0.55, topDark = 0, topBand = 0.35, tint = [1, 1, 1]) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / Math.max(1e-3, y1 - y0)));
    let a = base + (1 - base) * Math.pow(Math.min(1, t / 0.45), 0.7);
    if (topDark > 0) a *= 1 - topDark * Math.pow(Math.max(0, (t - (1 - topBand)) / topBand), 1.5);
    c[i * 3] = a * tint[0]; c[i * 3 + 1] = a * tint[1]; c[i * 3 + 2] = a * tint[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
