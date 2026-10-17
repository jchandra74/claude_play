// Global configuration: URL params, quality presets, camera views.
const params = new URLSearchParams(location.search);

export const QUALITY_PRESETS = {
  high: {
    name: 'high', renderScale: 1.0, msaa: 4, shadowSize: 4096, pointShadow: true, pointShadowSize: 1024,
    dofMaxCoc: 26, dofRadScale: 0.55, bloomLevels: 6, tufts: 9000, pointLights: 99,
    particles: 1.0, maxPixelRatio: 1,
  },
  med: {
    name: 'med', renderScale: 0.85, msaa: 0, shadowSize: 2048, pointShadow: false, pointShadowSize: 512,
    dofMaxCoc: 22, dofRadScale: 0.8, bloomLevels: 5, tufts: 4500, pointLights: 8,
    particles: 0.7, maxPixelRatio: 1,
  },
  low: {
    name: 'low', renderScale: 0.6, msaa: 0, shadowSize: 1024, pointShadow: false, pointShadowSize: 256,
    dofMaxCoc: 18, dofRadScale: 0.9, bloomLevels: 4, tufts: 1500, pointLights: 4,
    particles: 0.4, maxPixelRatio: 1,
  },
};

// Phones and tablets default to the light preset; ?quality= always wins.
const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const quality = QUALITY_PRESETS[params.get('quality')] || (touchDevice ? QUALITY_PRESETS.low : QUALITY_PRESETS.high);

// Camera views. Camera orbits `target` at `dist`, `pitch` (deg, down) and `yaw` (deg, around Y).
// focus = distance of the focal plane (defaults to dist). range = in-focus half-depth (m).
// aperture scales blur strength (px of CoC per relative depth offset).
export const VIEWS = {
  // hero: a low, cinematic tilt (Octopath town framing). Party + Great Lantern sit sharp in the lower
  // middle; terraces, rooftops, the hilltop chapel, forest, ridgelines and moonlit sky stack above.
  full:       { target: [0.2, 3.3, 0.6], dist: 27, pitch: 4.5, yaw: 0, fov: 32, focus: 26, range: 2.8, aperture: 18 },
  house:      { target: [8.2, 2.0, -5.6], dist: 13.5, pitch: 24, yaw: -16, fov: 30, range: 1.8, aperture: 40 },
  lantern:    { target: [0.3, 2.6, 0.4], dist: 16, pitch: 11, yaw: 12, fov: 30, range: 2.2, aperture: 30 },
  characters: { target: [0.2, 1.0, 1.2], dist: 10, pitch: 14, yaw: -4, fov: 30, range: 1.2, aperture: 28 },
  terrain:    { target: [-12.5, 0.8, 3.0], dist: 15, pitch: 34, yaw: 24, fov: 30, range: 2.5, aperture: 45 },
  tree:       { target: [10.2, 2.6, 3.4], dist: 13, pitch: 22, yaw: -22, fov: 30, range: 1.8, aperture: 40 },
};

export const viewName = VIEWS[params.get('view')] ? params.get('view') : 'full';
export const view = { ...VIEWS[viewName] };
// dev overrides (?pitch=18&dist=30&tx=..), used for framing iteration
for (const k of ['dist', 'pitch', 'yaw', 'fov', 'focus', 'range', 'aperture']) if (params.has(k)) view[k] = parseFloat(params.get(k));
['tx', 'ty', 'tz'].forEach((k, i) => { if (params.has(k)) { view.target = [...view.target]; view.target[i] = parseFloat(params.get(k)); } });

// Fixed time (seconds) for deterministic screenshots; otherwise animated.
export const fixedTime = params.has('t') ? parseFloat(params.get('t')) : null;
export const SHOT_TIME = 7.3;

export function cameraPose(v) {
  const d2r = Math.PI / 180;
  const p = v.pitch * d2r, y = v.yaw * d2r;
  const t = v.target;
  return {
    position: [t[0] + Math.sin(y) * Math.cos(p) * v.dist, t[1] + Math.sin(p) * v.dist, t[2] + Math.cos(y) * Math.cos(p) * v.dist],
    target: t,
    yaw: y,
  };
}
