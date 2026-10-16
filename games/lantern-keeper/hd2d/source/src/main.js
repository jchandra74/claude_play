// Entry: renderer, camera (per ?view=), scene assembly, frame loop. Sets window.__ready for shoot.mjs.
import * as THREE from 'three';
import { quality, view, viewName, cameraPose, fixedTime, SHOT_TIME } from './config.js';
import { HOUSES } from './layout.js';
import { loadAll } from './assets.js';
import { buildTerrain } from './terrain.js';
import { buildBuildings } from './buildings.js';
import { buildProps } from './props.js';
import { buildPlaza } from './plaza.js';
import { buildCharacters, updateCharacters } from './characters.js';
import { buildLighting, updateLighting } from './lighting.js';
import { buildSky } from './sky.js';
import { buildParticles } from './particles.js';
import { Pipeline } from './post.js';

window.__ready = false;
const debugNoPost = new URLSearchParams(location.search).has('nopost');

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x05070d, 1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1530, 0.0105);

  const pose = cameraPose(view);
  const camera = new THREE.PerspectiveCamera(view.fov, window.innerWidth / window.innerHeight, 0.5, 900);
  camera.position.set(...pose.position);
  camera.lookAt(new THREE.Vector3(...pose.target));
  camera.updateMatrixWorld();

  const ctx = { scene, camera, yaw: pose.yaw, quality, halos: [], houses: HOUSES, view };

  await loadAll();
  const sky = buildSky(ctx);
  buildTerrain(ctx);
  buildBuildings(ctx);
  buildProps(ctx);
  buildPlaza(ctx);
  buildCharacters(ctx);
  buildLighting(ctx);
  const particles = buildParticles(ctx);

  const post = new Pipeline(renderer, quality);
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    post.setSize(Math.round(w * pr * quality.renderScale), Math.round(h * pr * quality.renderScale));
    post.setFocus({ focus: view.focus ?? view.dist, range: view.range, aperture: view.aperture });
  };
  resize();
  window.addEventListener('resize', resize);

  const t0 = performance.now();
  let frames = 0;
  const frame = () => {
    const t = fixedTime ?? (SHOT_TIME + (performance.now() - t0) / 1000);
    updateLighting(ctx, t);
    updateCharacters(ctx, t);
    sky.update(t);
    particles.update(t);
    if (debugNoPost) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    else post.render(scene, camera, particles, ctx, t);
    frames++;
    if (frames >= 3 && !window.__ready) {
      window.__ready = true;
      console.log('ready view=' + viewName + ' quality=' + quality.name);
    }
    // with a fixed ?t= (screenshots) stop once ready so the page is idle for capture
    if (!(window.__ready && fixedTime !== null)) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start().catch(e => { console.error(e); window.__error = String(e && e.stack || e); });
