// Entry. Two modes:
//  - the playable demo (default): title -> story -> Whisperwood -> battles -> relight finale
//  - the still showcase (?view=full|house|lantern|characters|terrain|tree, used by shoot.mjs)
// Sets window.__ready once the first frames have rendered.
import * as THREE from 'three';
import { quality, view, viewName, cameraPose, fixedTime, SHOT_TIME, QUALITY_PRESETS } from './config.js';
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
import { buildGameTextures } from './game_tex.js';
import { buildForest, buildFireflies } from './forest.js';
import { bakeCollision, setLanternLevel } from './game_world.js';
import * as GAME from './game.js';
import { G } from './game_state.js';
import { menuActions, clearPressed } from './game_ui.js';
import { toast } from './game_state.js';

window.__ready = false;
const params = new URLSearchParams(location.search);
const debugNoPost = params.has('nopost');
const SHOWCASE = params.has('view');
const DTMAX = params.has('dtmax') ? parseFloat(params.get('dtmax')) : 0.1;

function makeRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x05070d, 1);
  renderer.domElement.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;display:block;';
  document.body.appendChild(renderer.domElement);
  return renderer;
}

async function showcase() {
  const renderer = makeRenderer();
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
  buildTerrain(ctx); buildBuildings(ctx); buildProps(ctx); buildPlaza(ctx); buildCharacters(ctx); buildLighting(ctx);
  const lk = params.has('lantern') ? parseFloat(params.get('lantern')) : 1;
  if (lk < 1) setLanternLevel(ctx, lk);
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
    if (lk < 1) setLanternLevel(ctx, lk);
    updateCharacters(ctx, t);
    sky.update(t);
    particles.update(t);
    if (debugNoPost) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    else post.render(scene, camera, particles, ctx, t);
    frames++;
    if (frames >= 3 && !window.__ready) { window.__ready = true; console.log('ready view=' + viewName + ' quality=' + quality.name); }
    if (!(window.__ready && fixedTime !== null)) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function play() {
  const renderer = makeRenderer();
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1530, 0.0105);
  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.5, 900);
  const ctx = { scene, camera, yaw: 0, quality, halos: [], houses: HOUSES, view };
  await loadAll();
  const n0 = scene.children.length;
  const sky = buildSky(ctx);
  ctx.skyObjs = scene.children.slice(n0);
  buildTerrain(ctx);
  buildBuildings(ctx);
  buildProps(ctx);
  buildPlaza(ctx);
  buildGameTextures();
  buildForest(ctx);
  GAME.buildActors(ctx);
  buildLighting(ctx);
  GAME.afterLighting(ctx);
  bakeCollision();
  const plazaParticles = buildParticles(ctx);
  const ff = buildFireflies();
  plazaParticles.scene.add(ff.pts);
  const particles = {
    scene: plazaParticles.scene,
    update(t) { plazaParticles.update(t); ff.update(t); },
    setPostUniforms(p, c) { plazaParticles.setPostUniforms(p, c); ff.setPostUniforms(p, c); },
  };

  const post = new Pipeline(renderer, quality);
  let preset = quality;
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    post.setSize(Math.round(w * pr * preset.renderScale), Math.round(h * pr * preset.renderScale));
  };
  resize();
  window.addEventListener('resize', resize);
  // Graphics presets switch for real at runtime: render scale, MSAA, bloom chain, DOF radius and the
  // moonlight shadow-map size (lights, tufts and particle counts stay as built at load).
  const order = ['low', 'med', 'high'];
  let qi = order.indexOf(quality.name);
  const applyPreset = (name) => {
    preset = QUALITY_PRESETS[name];
    qi = order.indexOf(name);
    post.q = preset;
    post.gather.uniforms.uRadScale.value = preset.dofRadScale;
    scene.traverse(o => {
      if (o.isDirectionalLight && o.castShadow && o.shadow.mapSize.x !== preset.shadowSize) {
        o.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
        if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      }
    });
    resize();
  };
  menuActions.qualityName = () => ['Low', 'Medium', 'High'][qi] + (autoQ.on ? ' (auto)' : '');
  menuActions.quality = () => { autoQ.on = false; applyPreset(order[(qi + 1) % 3]); };
  // automatic step-down: if frames stay slow for a few seconds, drop one preset (never steps up;
  // disabled when ?quality= is given or once the player picks a preset)
  const autoQ = { on: !params.has('quality'), acc: 0, n: 0, cool: 4 };
  const autoQuality = (ms) => {
    if (!autoQ.on || qi <= 0 || document.hidden) return;
    autoQ.cool -= ms / 1000;
    if (autoQ.cool > 0) return;
    autoQ.acc += ms; autoQ.n++;
    if (autoQ.acc < 3000) return;
    const avg = autoQ.acc / autoQ.n;
    autoQ.acc = 0; autoQ.n = 0;
    if (avg > 40) { applyPreset(order[qi - 1]); autoQ.cool = 5; toast('Graphics set to ' + ['Low', 'Medium', 'High'][qi] + ' for a smoother frame rate', '#c4b8de'); }
  };

  GAME.startGame();
  let last = performance.now(), frames = 0;
  const t0 = last;
  const frame = (now) => {
    const rawMs = now - last;
    let dt = Math.min(DTMAX, Math.max(0, rawMs / 1000));
    last = now;
    try {
      if (frames > 30 && rawMs < 2000) autoQuality(rawMs);
      // fixed sub-steps keep collision and scripts stable when a frame is long; one-shot presses
      // (menu / choice / battle cursor moves, confirms) are consumed by the first sub-step only
      let first = true;
      while (dt > 1e-4) { const s = Math.min(0.05, dt); GAME.update(s); dt -= s; if (first) { clearPressed(); first = false; } }
      const t = SHOT_TIME + (now - t0) / 1000;
      updateLighting(ctx, t);
      sky.update(t);
      particles.update(t);
      post.setFocus(GAME.focusInfo());
      if (debugNoPost) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
      else post.render(scene, camera, particles, GAME.hazeCtx(), t);
      GAME.drawOverlay();
    } catch (e) { console.error(e); window.__error = String(e && e.stack || e); }
    frames++; window.__frames = frames;
    if (frames >= 3 && !window.__ready) { window.__ready = true; console.log('ready game quality=' + quality.name); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__G = G;
}

(SHOWCASE ? showcase() : play()).catch(e => { console.error(e); window.__error = String(e && e.stack || e); });
