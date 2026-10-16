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

export const quality = QUALITY_PRESETS[params.get('quality')] || QUALITY_PRESETS.high;

// Camera views. Camera orbits `target` at `dist`, `pitch` (deg, down) and `yaw` (deg, around Y).
// focus = distance of the focal plane (defaults to dist). range = in-focus half-depth (m).
// aperture scales blur strength (px of CoC per relative depth offset).
export const VIEWS = {
  full:       { target: [0.2, 0.7, -2.3], dist: 29, pitch: 34, yaw: 0, fov: 28, range: 3.6, aperture: 92 },
  house:      { target: [8.2, 2.0, -5.6], dist: 13.5, pitch: 24, yaw: -16, fov: 30, range: 1.8, aperture: 40 },
  lantern:    { target: [0.3, 2.0, -0.4], dist: 14, pitch: 24, yaw: 12, fov: 30, range: 2.2, aperture: 45 },
  characters: { target: [0.2, 0.55, 1.4], dist: 8.5, pitch: 30, yaw: -4, fov: 30, range: 1.2, aperture: 28 },
  terrain:    { target: [-12.5, 0.8, 3.0], dist: 15, pitch: 34, yaw: 24, fov: 30, range: 2.5, aperture: 45 },
  tree:       { target: [10.2, 2.6, 3.4], dist: 13, pitch: 22, yaw: -22, fov: 30, range: 1.8, aperture: 40 },
};

export const viewName = VIEWS[params.get('view')] ? params.get('view') : 'full';
export const view = VIEWS[viewName];

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
