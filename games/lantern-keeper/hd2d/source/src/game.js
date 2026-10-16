// The Lantern Keeper, playable HD-2D demo: story, field logic, scenes, title / ending, test hooks.
// Story, dialogue and pacing follow the original 2D game (games/lantern-keeper/index.html); the
// world is the 3D Wickhollow plaza plus the Whisperwood (forest.js).
import * as THREE from 'three';
import { G, party, inventory, ITEMS, resetParty, wait, say, narrate, choose, toast, fadeTo, runScript, blocking, updateTimers, clearTimers } from './game_state.js';
import { audio, sfx } from './game_audio.js';
import {
  V, D, mountUI, pollInput, clearPressed, clearHits, pressed, inp, touch, updateDialog, drawDialog, drawCine, drawFade, drawControls,
  drawRotate, drawMenu, updateMenu, openMenu, menuActions, drawTitle, drawEnding, drawBubble, lerp, TAU,
} from './game_ui.js';
import { Actor, LIGHT } from './game_actors.js';
import { pxName, blobShadow } from './props.js';
import { groundY } from './terrain.js';
import { GREAT_LANTERN_LIGHT } from './layout.js';
import { radialTex, makeSprite } from './assets.js';
import { FOREST, forestGround, pathZ, forestLights } from './forest.js';
import {
  DYN, GATE, moveActor, blocked as blockedStatic, groundOf, setLanternLevel, lanternLevelImpl, makeProbe, applyArea, camState, CAMS, clampCam, placeCamera,
} from './game_world.js';
import { initBattle, startBattle, updateBattle, drawBattle, STAGE_POOLS } from './game_battle.js';

const qs = new URLSearchParams(location.search);
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const smooth = t => t * t * (3 - 2 * t);
const DIRV = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const dirFrom = (dx, dz) => Math.abs(dx) > Math.abs(dz) * 1.1 ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'down' : 'up');

let ctx = null, camera = null, env = null;
const A = {};                 // actors by id
const npcs = [];
const trail = [];
const follower = { active: false };
const enemiesOnMap = [];
const gerald = { fly: 0, home: null, pool: null };
const ofx = [];               // overlay particles (device px)
const rings = [];
let ember = null, gateAnim = 0, pipPool = null, forestFx = null;
let lampOrder = [];
const fgTrees = [];

export const CHAR_SCALE = 1.6;      // matches characters.js SCALE (42 texels/m character art)
const H = (k) => 0.95 * k * CHAR_SCALE;
const LO = CHAR_SCALE / 1.12;         // procedural side characters / monsters scale with the cast
const dirAnim = (n, h) => ({ down: [0, 1, 2, 3].map(i => pxName(`${n}_down_${i}`, h)), up: [0, 1, 2, 3].map(i => pxName(`${n}_up_${i}`, h)), right: [0, 1, 2, 3].map(i => pxName(`${n}_right_${i}`, h)) });

// ---------------- construction (before the lighting pass, so every material is hooked) ----------------
const NPC_DEFS = [
  { id: 'odo', name: 'Grandpa Odo', x: -10.75, z: -0.75, anim: { idle: ['odo_lying'] }, h: 0.57 * LO, lying: true, rx: 0.62, rz: 0.3 },
  { id: 'mayor', name: 'Mayor Bramblewick', x: -1.9, z: 1.65, sprite: 'mayor', h: H(1.17) },
  { id: 'moss', name: 'Moss', x: -5.5, z: -2.45, anim: dirAnim('moss', H(1.03)), h: H(1.03), dir: 'down' },
  { id: 'baker', name: 'Mrs. Pennywhistle', x: 7.6, z: -4.6, sprite: 'baker', h: H(1.13) },
  { id: 'zuzu', name: 'Madame Zuzu', x: 5.4, z: 2.4, sprite: 'zuzu', h: H(1.15) },
  { id: 'fenwick', name: 'Mr. Fenwick', x: 5.85, z: -2.05, four: 'fenwick', h: 1.07 * LO, dir: 'down' },
  { id: 'tobin', name: 'Tobin', x: -3.2, z: 3.55, sprite: 'kid', h: H(1.0), wander: 0.7 },
  { id: 'glen', name: 'Fisherman Glen', x: -5.3, z: 3.25, four: 'glen', h: 1.07 * LO, dir: 'up' },
  { id: 'barnaby', name: 'Guard Barnaby', x: 19.35, z: 0.6, sprite: 'guard', h: H(1.22) },
  { id: 'wendell', name: 'Guard Wendell', x: -3.9, z: -12.4, sprite: 'guard', h: H(1.22), flip: true },
  { id: 'biscuit', name: 'Biscuit', x: 1.6, z: -5.6, anim: { right: ['dog_0', 'dog_1'], down: ['dog_0', 'dog_1'], up: ['dog_0', 'dog_1'] }, h: 0.64 * LO, dog: true, wander: 1.6, flip: true },
  { id: 'cat', name: 'The Cat', x: -10.0, z: 1.05, anim: { idle: ['cat_0', 'cat_1'], loop: true }, h: 0.62 * LO, cat: true, fps: 1.2 },
];

export function buildActors(c) {
  ctx = c; camera = c.camera;
  const town = ctx.scene;
  // Pip & Moss
  A.pip = new Actor(town, { anim: dirAnim('pip', H(1.0)), h: H(1.0), ground: groundY, x: -9.85, z: 0.1, dir: 'left' });
  A.moss = new Actor(town, { anim: dirAnim('moss', H(1.03)), h: H(1.03), ground: groundY, x: 0, z: 0 });
  A.moss.visible = false;
  for (const d of NPC_DEFS) {
    let anim = d.anim;
    if (d.sprite) anim = { idle: [pxName(d.sprite, d.h)] };
    if (d.four) anim = { down: [`${d.four}_down`], up: [`${d.four}_up`], right: [`${d.four}_right`], left: [`${d.four}_left`] };
    const a = d.id === 'moss' ? A.moss : new Actor(town, { anim, h: d.h, ground: groundY, x: d.x, z: d.z, dir: d.dir || 'down', flip: d.flip, fps: d.fps || 8, sil: !d.lying });
    const n = { ...d, actor: a, home: { x: d.x, z: d.z }, wt: 0, tx: d.x, tz: d.z, talking: false, walkTo: null };
    a.solid = true; a.rx = d.rx ? d.rx * LO : 0.5; a.rz = d.rz ? d.rz * LO : 0.34;
    npcs.push(n);
    DYN.push(a);
  }
  // forest monsters on the map, and their battle doubles
  const mk = (kind) => kind === 'shrub'
    ? new Actor(town, { anim: { idle: ['shrub_0', 'shrub_1'], loop: true }, h: 1.05 * LO, fps: 3, ground: forestGround })
    : new Actor(town, { anim: { idle: ['mothling_0', 'mothling_1', 'mothling_2'], loop: true }, h: 0.95 * LO, fps: 9, ground: forestGround, shadow: 0.6 });
  const MAP = [
    { kind: 'shrub', lx: 9.5, battle: ['shrub'], tutorial: true, drop: 'cookie' },
    { kind: 'moth', lx: 19, battle: ['moth', 'moth'], drop: 'tea' },
    { kind: 'shrub', lx: 27.5, battle: ['shrub', 'moth'], drop: 'cookie' },
  ];
  for (const m of MAP) {
    const a = mk(m.kind);
    const x = FOREST.x0 + m.lx, z = FOREST.z0 + pathZ(m.lx) - 0.6;
    enemiesOnMap.push({ ...m, actor: a, hx: x, hz: z, x, z, alive: true, ph: Math.random() * 9, alert: 0, wt: 0, tx: x, tz: z, cool: 0 });
    a.x = x; a.z = z;
  }
  A.gerald = new Actor(town, { anim: { idle: ['gerald_0', 'gerald_1', 'gerald_2'], loop: true }, h: 2.55 * LO, fps: 3, ground: forestGround, emissive: 0.85, shadow: 0.55, sil: false });
  gerald.home = { x: FOREST.x0 + FOREST.clearX + 0.2, z: FOREST.z0 + FOREST.clearZ - 1.3 };
  const battleEnemies = { shrub: [mk('shrub'), mk('shrub')], moth: [mk('moth'), mk('moth')], gerald: [A.gerald] };
  for (const k of ['shrub', 'moth']) for (const a of battleEnemies[k]) a.visible = false;
  buildGate();
  ctx.characters = [A.pip, A.moss, ...npcs.map(n => n.actor)].filter((a, i, arr) => arr.indexOf(a) === i)
    .map(a => ({ def: { name: 'actor' }, sprite: a.mesh, baseY: 0, sil: a.sil }));
  env = { ctx, camera, pip: A.pip, moss: A.moss, enemies: battleEnemies, ground: groundY };
  initBattle(env);
  // the ember (finale): a hot additive glow sprite
  const em = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(), color: new THREE.Color(5, 3, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  em.scale.set(0.7, 0.7, 1); em.visible = false; em.renderOrder = 12;
  ctx.scene.add(em);
  A.emberSprite = em;
}

function buildGate() {
  const y = groundY(GATE.x, -0.2);
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 1 });
  for (const z of [GATE.z0, GATE.z1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.15, 0.2), wood);
    p.position.set(GATE.x, y + 0.575, z); p.castShadow = true; p.receiveShadow = true; g.add(p);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.28), wood);
    cap.position.set(GATE.x, y + 1.19, z); g.add(cap);
  }
  const c = document.createElement('canvas'); c.width = 32; c.height = 4;
  const x2 = c.getContext('2d');
  for (let i = 0; i < 32; i++) { x2.fillStyle = Math.floor(i / 4) % 2 ? '#e04a3a' : '#f4efe6'; x2.fillRect(i, 0, 1, 4); }
  x2.fillStyle = 'rgba(0,0,0,0.25)'; x2.fillRect(0, 3, 32, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  const boomMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  const len = GATE.z1 - GATE.z0 + 0.3;
  const geo = new THREE.BoxGeometry(0.12, 0.12, len);
  // stripes run along the boom (box UVs: remap the long faces)
  geo.translate(0, 0, len / 2);
  const pivot = new THREE.Group();
  pivot.position.set(GATE.x, y + 0.88, GATE.z0);
  const boom = new THREE.Mesh(geo, boomMat); boom.castShadow = true;
  pivot.add(boom);
  g.add(pivot);
  ctx.scene.add(g);
  GATE.pivot = pivot;
  // a street lamp by the gate (registered with the lamps so the lighting pass lights it)
  const lx = GATE.x - 0.1, lz = GATE.z0 - 0.45, lh = 2.6;
  const lamp = makeSprite(pxName('lamp', lh), { h: lh, yaw: 0, unlit: 0xb09a86, emissive: true, emissiveIntensity: 4.5, emissiveOpts: { threshold: 0.5, warm: 0.12, region: [0, 0.3] }, selfLight: 0.06 });
  const ly = groundY(lx, lz);
  lamp.position.set(lx, ly, lz);
  ctx.scene.add(lamp, blobShadow(lx, ly, lz, 0.3, 0.2, 0.6));
  ctx.lamps.push({ x: lx, y: ly + lh * 0.86, z: lz + 0.02, sprite: lamp });
}

// after the lighting pass: forest pools, Pip's hand-lantern pool, lamp order, probes
export function afterLighting() {
  forestFx = forestLights(ctx);
  pipPool = { pos: new THREE.Vector3(), color: new THREE.Color(1.0, 0.62, 0.3), intensity: 1.5, radius: 3.4, core: 1.2, prio: -2, seed: 7.3, weight: 99 };
  gerald.pool = { pos: new THREE.Vector3(), color: new THREE.Color(1.0, 0.55, 0.22), intensity: 4, radius: 5.5, core: 0.5, prio: -2, seed: 2.1, weight: 99 };
  ctx.pools.unshift(pipPool, gerald.pool, ...STAGE_POOLS);
  const L = GREAT_LANTERN_LIGHT;
  const lamps = (ctx.lamps || []).map(l => ({ ...l, d: Math.hypot(l.x - L.x, l.z - L.z) }));
  const maxD = Math.max(...lamps.map(l => l.d), 1);
  // same thresholds as lighting.js setLanternLevel: lamp lights at 0.3 + 0.5 x normalised distance
  lampOrder = lamps.sort((a, b) => a.d - b.d).map(l => ({ x: l.x, y: l.y, z: l.z, th: 0.3 + 0.5 * l.d / maxD, on: false }));
  const extra = [
    { on: true, x: 0, z: 0, k: 0.55, color: new THREE.Color(1.0, 0.62, 0.3) },      // Pip's lantern
    { on: false, x: 0, z: 0, k: 1.2, color: new THREE.Color(1.0, 0.6, 0.25) },      // Gerald's tummy
  ];
  LIGHT.probe = makeProbe(ctx, G, extra);
  LIGHT.extra = extra;
  // tall foreground framing trees: hidden while they would cover the middle of a follow shot
  const wp = new THREE.Vector3();
  ctx.scene.traverse(o => {
    if (!o.isMesh || !o.userData.size || o.userData.size[1] < 0.5) return;
    o.getWorldPosition(wp);
    const forest = wp.x > 300;
    if (!forest && o.userData.size[1] < 3.5) return;
    if (forest || wp.z > 9) fgTrees.push({ o, p: wp.clone(), h: o.userData.size[1], w: o.userData.size[0], forest });
    // the road to the Whisperwood gate is kept clear of the random side trees
    if (!forest && wp.x > 17.5 && wp.x < 24 && wp.z > -3.5 && wp.z < 3.5) o.visible = false;
  });
  menuActions.toTitle = () => runScript(async () => { await fadeTo(1, 0.6); toTitle(); });
}

// ---------------- state reset ----------------
function placeNPCsHome() {
  for (const n of npcs) {
    const a = n.actor;
    a.x = n.home.x; a.z = n.home.z; a.dir = n.dir || 'down'; a.visible = true; a.moving = false; a.ground = groundY;
    n.tx = n.x; n.tz = n.z; n.walkTo = null; n.talking = false; n.wander = NPC_DEFS.find(d => d.id === n.id).wander || 0;
    n.joined = false; a.solid = true; a.tilt = 0; a.lift = 0;
  }
}
function resetState() {
  resetParty();
  clearTimers();
  placeNPCsHome();
  for (const e of enemiesOnMap) { e.alive = true; e.x = e.hx; e.z = e.hz; e.cool = 0; e.alert = 0; e.actor.visible = true; e.actor.x = e.x; e.actor.z = e.z; }
  Object.assign(A.gerald, { x: gerald.home.x, z: gerald.home.z, lift: 0.75, ground: forestGround }); A.gerald.visible = true; A.gerald.U.uFade.value = 0; A.gerald.mat.emissiveIntensity = 0.85; gerald.ember = true;
  gerald.fly = 0;
  GATE.open = false; gateAnim = 0;
  G.lanternK = 0; G.lit = false;
  for (const l of lampOrder) l.on = false;
  follower.active = false; trail.length = 0;
  A.moss.visible = true; A.moss.ground = groundY;
  Object.assign(A.pip, { x: -9.85, z: 0.1, dir: 'left', moving: false, ground: groundY, walkTo: null });
  setArea('town');
  ofx.length = 0; rings.length = 0; ember = null; A.emberSprite.visible = false;
  G.cineTarget = 0; G.battle = null;
  snapCamToPlayer();
  syncAll();
}

function syncAll() {
  for (const a of [A.pip, A.moss, A.gerald, ...npcs.map(n => n.actor), ...enemiesOnMap.map(e => e.actor)]) a.update(0);
}
function setArea(area) {
  G.area = area;
  applyArea(ctx, area);
  const g = area === 'forest' ? forestGround : groundY;
  A.pip.ground = g; A.moss.ground = g;
  env.ground = g;
}
function snapCamToPlayer() {
  const c = CAMS.field;
  const [tx, tz] = clampCam(G.area, A.pip.x, A.pip.z);
  Object.assign(camState, { tx, tz, ty: A.pip.ground(A.pip.x, A.pip.z) + c.lift, wantDist: c.dist, wantPitch: c.pitch, range: c.range, aperture: c.aperture, lock: false });
  camState.x = camState.tx; camState.y = camState.ty; camState.z = camState.tz; camState.dist = c.dist; camState.pitch = c.pitch;
}
function heroCam(snap, ty = 3.3) {
  Object.assign(camState, { tx: 0.2, ty, tz: 0.6, wantDist: 27, wantPitch: 4.5, range: 2.8, aperture: 18, lock: true, focusOverride: 26 });
  if (snap) { camState.x = 0.2; camState.y = ty; camState.z = 0.6; camState.dist = 27; camState.pitch = 4.5; }
}

// ---------------- conversations ----------------
const npc = id => npcs.find(n => n.id === id);
const TALK = {
  async odo() {
    if (G.flags.moss) await say('Grandpa Odo', 'Is that the Moss kid? Good. That one owns a slingshot and a very powerful sigh.');
    else if (G.flags.mayor) await say('Grandpa Odo', 'A buddy, eh? Try the moody one by the bench. Moody people are excellent in a crisis. They\'ve been practising.');
    else await say('Grandpa Odo', 'Ohh, my back. Don\'t mind me. I\'m just going to lie here and think about pigeons.');
  },
  async mayor() {
    if (!G.flags.mayor) {
      await say('Mayor Bramblewick', 'Ah! Young Pip! Grandpa Odo\'s grandchild! Splendid! Terrible! Both!');
      await say('Mayor Bramblewick', 'As you can see, the Great Lantern is out. As you can also see, I am extremely calm. This is my calm face.');
      await say('Mayor Bramblewick', 'Witnesses report an ENORMOUS winged shape flapping off east into the Whisperwood, glowing like a dropped birthday cake.');
      await say('Mayor Bramblewick', 'As Mayor, I hereby authorise you to go and get our flame back. Here: an official permission slip.');
      sfx('item');
      await narrate('Pip got the Permission Slip! It says PERMISSION in crayon.');
      await say('Mayor Bramblewick', 'Oh, and take a buddy! Safety in numbers. Two is a number.');
      await say('Mayor Bramblewick', 'I\'d come myself, but my hat is not rated for forests.');
      G.flags.mayor = true;
      toast('Find a buddy, then head to the east gate');
    } else if (!G.flags.moss) await say('Mayor Bramblewick', 'Go, brave Pip! Find a buddy! I\'ll be right here. Being brave. In my mind.');
    else await say('Mayor Bramblewick', 'A buddy! Wonderful! Off to the east gate, you two! Bring back the flame! And maybe a souvenir!');
  },
  async moss(n) {
    if (!G.flags.mayor) {
      G.flags.mossRebuff = (G.flags.mossRebuff || 0) + 1;
      await say('Moss', G.flags.mossRebuff % 2 ? '...Go away. I\'m brooding.' : 'Brooding is a full-time job. The pay is terrible. Like yours, I hear.');
      return;
    }
    await say('Moss', 'Oh. It\'s the lantern kid. Nice beanie. I hate it.');
    await say('Moss', 'So the Mayor wants you to walk into the Whisperwood. At night. Where it\'s dark and spooky and full of things.');
    await choose(['Come with me?', 'Want to be my buddy?']);
    await say('Moss', 'Hmm. Darkness. Danger. Possible doom.');
    await say('Moss', '...Finally, someone gets me.');
    await say('Moss', 'Also, no Lantern means no ovens, and no ovens means no cinnamon buns. I have needs.');
    sfx('levelup');
    await narrate('Moss joined the party!');
    party[1].joined = true;
    follower.active = true;
    n.actor.solid = false;
    n.joined = true;
    trail.length = 0;
    G.flags.moss = true;
    await say('Moss', 'I\'ll bring my slingshot. And my sighs. Lead the way.');
    toast('Head to the east gate');
  },
  async baker() {
    if (!G.flags.cookies) {
      await say('Mrs. Pennywhistle', 'Pip, dear! Without the Lantern\'s flame my ovens won\'t light! These are the last cookies in Wickhollow.');
      await say('Mrs. Pennywhistle', 'Take three. Don\'t tell anyone. Especially the cookies.');
      inventory.cookie += 3; G.flags.cookies = true; sfx('item');
      await narrate('Pip got 3 Cookies! They are still warm, somehow.');
    } else await say('Mrs. Pennywhistle', pick(['My ovens are cold. My heart is cold. My scones... don\'t ask about the scones.', 'If you see the flame, tell it I miss it. Tell it the croissants miss it too.']));
  },
  async zuzu() {
    await say('Madame Zuzu', 'Ahh. I sensed you were coming. Also, I saw you walking over here.');
    if (!G.flags.mayor) await say('Madame Zuzu', 'The spirits say... talk to the Mayor. The spirits are very practical.');
    else if (!G.flags.moss) await say('Madame Zuzu', 'I see... a grumpy companion. Near a bench. Wearing a hood. Sighing. The spirits are also sighing.');
    else if (!G.flags.gerald) await say('Madame Zuzu', 'I see a great winged beast in the east. Its name begins with G. It is... Gerald. The spirits say he is "a sweetheart, really".');
    else await say('Madame Zuzu', 'I see... a happy ending. And a sequel. Possibly.');
  },
  async fenwick() {
    if (!G.flags.fenwick) {
      await say('Mr. Fenwick', 'Evening. I\'m waiting for the 7:15 bus.');
      await say('Pip', '...');
      await say('Mr. Fenwick', 'What do you mean there\'s no bus in Wickhollow? Then I\'ll wait for one to be invented.');
      G.flags.fenwick = true;
    } else await say('Mr. Fenwick', pick(['Any minute now.', 'I\'ve been waiting since 1987. It builds character.', 'If a bus does come, I\'m not sharing it.']));
  },
  async tobin() {
    await say('Tobin', pick(['I\'m guarding the town with this stick! It\'s a very serious stick.', 'If you find the flame thief, hit it with your broom. That\'s what I\'d do. Then I\'d run away. That\'s also what I\'d do.', 'This stick has never lost a fight. It has also never been in one.']));
  },
  async glen() {
    await say('Fisherman Glen', 'Shh. I\'m fishing for compliments. In the well. The well has the best compliments.');
    const c = await choose(['Nice hat!', '...']);
    if (c === 0) await say('Fisherman Glen', 'Oh! A bite! Thank you! It\'s a family hat. My family is mostly hats.');
    else await say('Fisherman Glen', 'Hm. Nothing biting tonight.');
  },
  async barnaby() {
    if (GATE.open) { await say('Guard Barnaby', 'Be careful out there! Moths love light. You are carrying a lantern. Just... thinking out loud.'); return; }
    if (!G.flags.mayor) {
      await say('Guard Barnaby', 'Halt! Nobody enters the Whisperwood without the Mayor\'s permission!');
      await say('Guard Barnaby', 'Also, you need a buddy. Rules are rules. I made them up just now.');
    } else if (!G.flags.moss) {
      await say('Guard Barnaby', 'A permission slip! In crayon! Very official.');
      await say('Guard Barnaby', 'But you\'ve got no buddy. The Whisperwood eats lonely people. Probably. I\'ve never checked.');
    } else {
      await say('Guard Barnaby', 'Permission? Check. Buddy?');
      await say('Moss', 'Ugh.');
      await say('Guard Barnaby', '...Grumpy, but check! Off you go!');
      sfx('gate');
      GATE.open = true;
      G.shake = 1.5;
      toast('The east gate is open!');
      await say('Guard Barnaby', 'I\'ll be right here, guarding the... well, everything.');
    }
  },
  async wendell() {
    await say('Guard Wendell', pick(['Barnaby has the east gate. I have the north stairs. The north stairs have never tried anything.', 'Dark night, eh? I\'ve been counting the stars. I\'m on three. I keep losing my place.']));
  },
  async biscuit() { await narrate(pick(['Biscuit wags. (He is thinking about you as a sandwich.)', 'Biscuit sniffs your lantern. Biscuit approves.', 'Biscuit rolls over. It is the best thing that has happened all night.'])); },
  async cat() { await narrate(pick(['The cat stares at you. You feel judged. Correctly.', 'The cat yawns. It has seen braver Lantern Keepers.'])); },
};
const CHECKS = [
  { id: 'plaque', area: 'town', x: 0, z: 1.55, r: 1.1, async fn() {
    if (G.lit) await narrate('THE GREAT LANTERN. Burning brightly. Someone has added a note: "Thank you, Pip." Someone else added: "and Moss".');
    else await narrate('THE GREAT LANTERN. Lit three hundred years ago. Please do not lick. (The cage is cold and dark.)');
  } },
  { id: 'well', area: 'town', x: -5.2, z: 2.0, r: 1.25, async fn() { await narrate('You peer into the well. The well peers back. It\'s a well.'); } },
  { id: 'bench', area: 'town', x: 4.9, z: -1.3, r: 1.0, async fn() { await narrate('A bench. Someone has carved BUS STOP into it. Then "SOON". Then "PROBABLY NOT".'); } },
  { id: 'gate', area: 'town', x: GATE.x - 0.2, z: -0.15, r: 1.2, when: () => !GATE.open, async fn() { await narrate('A barrier with a sign: CLOSED. ASK BARNABY. Barnaby is standing right there.'); } },
  { id: 'sign', area: 'forest', get x() { return FOREST.sign.x; }, get z() { return FOREST.sign.z; }, r: 1.1, async fn() { await narrate('WHISPERWOOD. Beware of: moths, shrubs, feelings.'); } },
  { id: 'mushroom', area: 'forest', x: FOREST.x0 + 14, z: 0, r: 0, async fn() { await narrate('A glowing mushroom. It hums faintly. Don\'t eat it. (You were going to eat it.)'); } },
];

function findInteract() {
  const P = A.pip, [dx, dz] = DIRV[P.dir];
  const px = P.x + dx * 0.75, pz = P.z + dz * 0.6;
  let best = null, bd = 1e9;
  for (const n of npcs) {
    if (!n.actor.visible || n.joined || !TALK[n.id] || (G.area !== 'town')) continue;
    const r = n.lying ? 1.5 : 1.0, d = Math.hypot(px - n.actor.x, pz - n.actor.z);
    if (d < r && d < bd) { best = { n }; bd = d; }
  }
  for (const c of CHECKS) {
    if (c.area !== G.area || (c.when && !c.when())) continue;
    let r = c.r, cx = c.x, cz = c.z;
    if (c.id === 'mushroom') {
      // any glowing mushroom cluster near the path
      for (const m of forestMush()) { const d = Math.hypot(px - m.x, pz - m.z); if (d < 0.8 && d < bd) { best = { c }; bd = d; } }
      continue;
    }
    const d = Math.hypot(px - cx, pz - cz);
    if (d < r && d < bd) { best = { c }; bd = d; }
  }
  return best;
}
let _mush = null;
function forestMush() { return _mush || (_mush = (forestFx ? forestFx.pools.map(p => ({ x: p.pos.x, z: p.pos.z })) : [])); }

function interact(t) {
  if (t.n) {
    const n = t.n;
    if (n.four) n.actor.dir = { left: 'right', right: 'left', up: 'down', down: 'up' }[A.pip.dir];
    n.talking = true;
    runScript(async () => { await TALK[n.id](n); n.talking = false; if (n.four) n.actor.dir = n.dir || 'down'; });
  } else runScript(() => t.c.fn());
}

// ---------------- field ----------------
function walkPlayer(x, z) { return new Promise(res => { A.pip.walkTo = { x, z, res }; }); }

function updateField(dt) {
  const P = A.pip;
  const free = !blocking() && G.fade.a < 0.3 && G.mode === 'field';
  let run = false;
  if (free) {
    if (pressed.menu) { openMenu(); pressed.menu = false; }
    run = inp.run || inp.b || inp.stickRun;
    const mx = inp.mx, my = inp.my, mag = Math.hypot(mx, my);
    if (mag > 0.05) {
      const sp = 2.6 * (run ? 1.7 : 1) * Math.min(1, 0.35 + mag * 0.8);
      P.dir = dirFrom(mx, my);
      P.moving = moveActor(G.area, P, mx * sp * dt, my * sp * dt);
    } else P.moving = false;
    const t = findInteract();
    G.hint = t ? (t.n ? 'TALK' : 'LOOK') : '';
    G.target = t;
    if (pressed.a && t) interact(t);
    checkTriggers();
  } else { if (!P.walkTo) P.moving = false; G.target = null; }
  if (P.walkTo) {
    const dx = P.walkTo.x - P.x, dz = P.walkTo.z - P.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { const r = P.walkTo.res; P.walkTo = null; P.moving = false; r(); }
    else { const sp = 1.8 * dt; P.x += dx / d * Math.min(sp, d); P.z += dz / d * Math.min(sp, d); P.dir = dirFrom(dx, dz); P.moving = true; }
  }
  P.update(dt, run ? 1.6 : 1);
  // follower trail
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(last.x - P.x, last.z - P.z) >= 0.05) { trail.push({ x: P.x, z: P.z, dir: P.dir }); if (trail.length > 60) trail.shift(); }
  const M = A.moss;
  if (follower.active) {
    const idx = trail.length - 1 - 20;
    if (idx >= 0) {
      const p = trail[idx];
      const mv = Math.hypot(M.x - p.x, M.z - p.z) > 0.01;
      M.x = p.x; M.z = p.z;
      if (mv) M.dir = p.dir;
      M.moving = mv && P.moving;
    } else M.moving = false;
    M.update(dt, run ? 1.6 : 1);
  }
  // npcs
  for (const n of npcs) {
    const a = n.actor;
    if (n.joined || !a.visible) continue;
    if (n.wander && !n.talking && !G.scriptBusy && G.area === 'town') {
      n.wt -= dt;
      if (n.wt <= 0) { n.wt = rand(2, 5); const ang = rand(0, TAU), r = rand(0, n.wander); n.tx = n.home.x + Math.cos(ang) * r; n.tz = n.home.z + Math.sin(ang) * r * 0.6; }
      const dx = n.tx - a.x, dz = n.tz - a.z, d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const sp = (n.dog ? 1.2 : 0.8) * dt;
        const mv = moveActor('town', a, dx / d * sp, dz / d * sp);
        a.dir = dirFrom(dx, dz); a.moving = mv;
        if (!mv) n.wt = 0;
      } else a.moving = false;
    } else if (!n.walkTo) a.moving = false;
    a.update(dt);
  }
  // map monsters
  for (const en of enemiesOnMap) {
    if (!en.alive) continue;
    const a = en.actor;
    en.cool = Math.max(0, en.cool - dt);
    const d = Math.hypot(en.x - P.x, en.z - P.z);
    const sp = en.kind === 'moth' ? 1.5 : 1.15;
    if (free && G.area === 'forest' && d < 3.6 && en.cool <= 0) {
      en.alert = 1;
      a.x = en.x; a.z = en.z;
      moveActor('forest', a, (P.x - en.x) / d * sp * dt, (P.z - en.z) / d * sp * dt);
      en.x = a.x; en.z = a.z;
      if (d < 0.75) { runScript(() => encounter(en)); break; }
    } else {
      en.alert = Math.max(0, en.alert - dt);
      en.wt -= dt;
      if (en.wt <= 0) { en.wt = rand(1.5, 3.5); en.tx = en.hx + rand(-1.2, 1.2); en.tz = en.hz + rand(-0.6, 0.6); }
      const dx = en.tx - en.x, dz = en.tz - en.z, dd = Math.hypot(dx, dz);
      if (dd > 0.08 && free) { a.x = en.x; a.z = en.z; moveActor('forest', a, dx / dd * 0.55 * dt, dz / dd * 0.55 * dt); en.x = a.x; en.z = a.z; }
    }
    a.x = en.x; a.z = en.z;
    a.lift = en.kind === 'moth' ? 0.55 + Math.sin(G.t * 3 + en.ph) * 0.08 : 0;
    a.update(dt);
  }
  // Gerald (clearing / flying away / roof)
  {
    const g = A.gerald;
    if (gerald.fly) { g.lift += 2.6 * dt; g.x += (Math.sin(G.t * 3) * 1.2 + 0.8) * dt; g.fps = 12; }
    else g.fps = 3;
    g.bob = Math.sin(G.t * 2) * 0.07;
    if (g.visible) g.update(dt);
  }
  // gate boom
  const gt = GATE.open ? 1 : 0;
  gateAnim += (gt - gateAnim) * Math.min(1, dt * 3);
  GATE.pivot.rotation.x = -gateAnim * Math.PI * 0.47;
  // camera
  if (!camState.lock) {
    const c = CAMS.field;
    const [lx, lz] = P.moving ? DIRV[P.dir] : [0, 0];
    const [tx, tz] = clampCam(G.area, P.x + lx * 1.3, P.z + lz * 0.6);
    camState.tx = tx; camState.tz = tz; camState.ty = P.ground(P.x, P.z) + c.lift;
    camState.wantDist = c.dist; camState.wantPitch = c.pitch; camState.range = c.range; camState.aperture = c.aperture;
    camState.focusOverride = null;
  }
  // music by area
  if (G.mode === 'field' && !G.scriptBusy) {
    const want = G.area === 'forest' ? 'forest' : 'town';
    if (want !== audio.songName) audio.play(want);
  }
}

function checkTriggers() {
  const P = A.pip;
  if (G.area === 'town' && GATE.open && P.x > 20.75) runScript(() => gotoArea('forest', FOREST.x0 + 0.4, FOREST.z0 + pathZ(0.4), 'right'));
  else if (G.area === 'forest' && P.x < FOREST.x0 - 3.6) runScript(() => gotoArea('town', 19.9, -0.1, 'left'));
  else if (G.area === 'forest' && !G.flags.gerald && P.x > FOREST.x0 + 33.5) runScript(geraldScene);
}

async function gotoArea(area, x, z, dir) {
  await fadeTo(1, 0.45);
  setArea(area);
  Object.assign(A.pip, { x, z, dir, moving: false });
  trail.length = 0;
  const [dx] = DIRV[dir];
  Object.assign(A.moss, { x: x - dx * 0.8, z, dir });
  A.moss.ground = A.pip.ground;
  snapCamToPlayer();
  audio.play(area === 'forest' ? 'forest' : 'town');
  if (area === 'forest' && !G.flags.forestIntro) {
    G.flags.forestIntro = true;
    await fadeTo(0, 0.6);
    await say('Moss', 'The Whisperwood. It\'s whispering. Mostly about us.');
    await say('Moss', 'Monsters wander the path. Bump into one and we fight. Or don\'t, and we don\'t.');
    return;
  }
  await fadeTo(0, 0.6);
}

// ---------------- battles from the field ----------------
async function encounter(en) {
  sfx('encounter');
  G.shake = 3;
  await wait(0.35);
  await fadeTo(1, 0.25, '#ffffff');
  en.actor.visible = false;
  const saved = { px: A.pip.x, pz: A.pip.z, mx: A.moss.x, mz: A.moss.z, dir: A.pip.dir };
  const cx = (A.pip.x + en.x) / 2 + 0.6, cz = FOREST.z0 + pathZ(cx - FOREST.x0) - 0.2;
  const p = startBattle(en.battle, { tutorial: en.tutorial && !G.flags.tutorialDone, drop: en.drop, cx, cz });
  G.fade.a = 0; G.fade.target = 0;
  const r = await p;
  if (en.tutorial) G.flags.tutorialDone = true;
  await fadeTo(1, 0.35);
  G.battle = null;
  G.mode = 'field';
  audio.play('forest');
  Object.assign(A.pip, { x: saved.px, z: saved.pz, dir: saved.dir }); Object.assign(A.moss, { x: saved.mx, z: saved.mz });
  if (r === 'win') { en.alive = false; en.actor.visible = false; }
  else {
    en.actor.visible = true;
    if (r === 'flee') { en.cool = 3; en.x = en.hx; en.z = en.hz; A.pip.x -= 1.2; }
    else {
      for (const m of party) { m.hp = m.maxHp; m.sp = m.maxSp; }
      Object.assign(A.pip, { x: FOREST.x0 + 0.6, z: FOREST.z0 + pathZ(0.6), dir: 'right' });
      trail.length = 0; Object.assign(A.moss, { x: A.pip.x - 0.8, z: A.pip.z });
      en.x = en.hx; en.z = en.hz; en.cool = 2;
    }
  }
  A.pip.dir = r === 'flee' ? 'left' : A.pip.dir;
  A.moss.dir = A.pip.dir;
  snapCamToPlayer();
  await fadeTo(0, 0.5);
  if (r === 'lose') {
    await narrate('Pip woke up at the forest edge. Moss is pretending not to have been worried.');
    await say('Moss', 'I wasn\'t worried. My eyes are just sweaty.');
  }
  if (r === 'win') for (const m of party) if (m.joined) m.hp = Math.max(m.hp, Math.round(m.maxHp * 0.5));
}

// ---------------- story beats ----------------
async function introScene() {
  G.fade.a = 1; G.fade.target = 1;
  G.cineTarget = 1;
  audio.play('title');
  await wait(0.6);
  await narrate('In the village of Wickhollow, the Great Lantern has burned for three hundred years.');
  await narrate('It keeps the nights soft, the bread warm, and the moths... mostly polite.');
  await narrate('Last night, it went out.');
  audio.play('town');
  snapCamToPlayer();
  await fadeTo(0, 1.4);
  await wait(0.4);
  await say('Grandpa Odo', 'Pip! Is that you? Good. Don\'t come any closer. I can feel my back judging me.');
  await say('Grandpa Odo', 'I sneezed at a pigeon this morning and something went "ping". Now I live down here.');
  await say('Grandpa Odo', 'The Great Lantern\'s gone dark, and the Lantern Keeper can\'t stand up. That makes YOU the Lantern Keeper.');
  await say('Grandpa Odo', 'Temporarily. Unpaid. Congratulations.');
  sfx('levelup');
  await narrate('Pip became the Acting Interim Lantern Keeper (Unpaid)!');
  await say('Grandpa Odo', 'Take the Broom of Office. And keep that little lantern of yours lit. The night\'s gotten hungry.');
  sfx('item');
  await narrate('Pip got the Broom of Office! ...It\'s a broom.');
  await say('Grandpa Odo', 'Now go see the Mayor in the plaza. He\'ll know what to do.');
  await say('Grandpa Odo', 'He won\'t. But he\'ll say a lot of words, and some of them might be useful.');
  G.cineTarget = 0;
  G.flags.intro = true;
  toast(touch.ui ? 'Drag on the left to walk · A to talk' : 'Arrows/WASD to walk · Z to talk · Shift to run');
}

async function geraldScene() {
  G.flags.gerald = true;
  G.cineTarget = 1;
  audio.stopMusic();
  A.pip.moving = false;
  camState.lock = true;
  camState.tx = FOREST.x0 + FOREST.clearX - 1.5; camState.tz = FOREST.z0 + FOREST.clearZ; camState.ty = 2.4; camState.wantDist = 17; camState.wantPitch = 8;
  await wait(1.3);
  await say('???', 'Mmm... so warm... so shiny...');
  await say('Moss', 'Oh no.');
  await say('Moss', 'It\'s a moth. A really, REALLY big moth.');
  await say('Gerald', 'Oh! Hello! Visitors! I\'m Gerald!');
  await say('Gerald', 'Did you know your Lantern is the most beautiful thing in the whole entire world? I just wanted to hold it.');
  await say('Gerald', 'And then I sort of... ate it.');
  await say('Moss', 'You ate the flame.');
  await say('Gerald', 'It was an accident! A delicious, glowing accident!');
  const c = await choose(['Give it back!', '...Was it tasty?']);
  if (c === 0) await say('Gerald', 'No! It\'s MINE now! It\'s warm in my tummy and it makes me feel like a nightlight!');
  else await say('Gerald', 'SO tasty. Like a warm hug for your insides. ...You can\'t have it back though.');
  await say('Gerald', 'I\'ll fight you for it! I\'ve never fought anyone! Is this how you do it?!');
  await say('Moss', 'Snack break first. I\'m not fighting a moth on an empty stomach.');
  for (const m of party) if (m.joined) { m.hp = m.maxHp; m.sp = m.maxSp; }
  sfx('heal');
  await narrate('The party had a quick snack. HP and SP fully restored!');
  G.cineTarget = 0;
  await bossFight();
}
async function bossFight() {
  while (true) {
    sfx('encounter'); G.shake = 4;
    await wait(0.4);
    await fadeTo(1, 0.25, '#ffffff');
    const cx = FOREST.x0 + FOREST.clearX - 0.2, cz = FOREST.z0 + FOREST.clearZ + 0.4;
    const p = startBattle(['gerald'], { boss: true, cx, cz });
    G.fade.a = 0; G.fade.target = 0;
    const r = await p;
    await fadeTo(1, 0.4);
    G.battle = null; G.mode = 'field';
    // after the fight: the party faces Gerald in the clearing
    Object.assign(A.pip, { x: cx + 2.4, z: cz - 0.2, dir: 'left' });
    Object.assign(A.moss, { x: cx + 3.2, z: cz + 0.5, dir: 'left' });
    trail.length = 0;
    camState.lock = true;
    Object.assign(camState, { tx: cx + 0.2, tz: cz, ty: 2.2, wantDist: 16, wantPitch: 8 });
    await fadeTo(0, 0.5);
    if (r === 'win') break;
    for (const m of party) if (m.joined) { m.hp = m.maxHp; m.sp = m.maxSp; }
    await say('Gerald', 'Oh no, are you okay?! I\'m so sorry! I don\'t know my own flappiness!');
    await say('Moss', 'Ow. Okay. Round two. Remember: break him before the big flap.');
  }
  await geraldAfter();
}
async function geraldAfter() {
  G.cineTarget = 1;
  const g = A.gerald;
  await say('Gerald', 'Okay okay OKAY! I give up! You\'re very good at hitting!');
  await say('Gerald', '*hic* ... *hic* ... *HUURK*');
  const s = toScreen(g, 0.4);
  for (let i = 0; i < 60; i++) ofx.push({ x: s[0], y: s[1], vx: rand(-260, 260) * V.S / 3, vy: rand(-320, 40) * V.S / 3, g: 300 * V.S / 3, life: rand(0.6, 1.2), t: 0, col: pick([[255, 230, 140], [255, 170, 80], [255, 255, 220]]), s: rand(1, 2.2) });
  G.flash = 0.5;
  gerald.ember = false;
  g.mat.emissiveIntensity = 0.12;   // the tummy goes dark once the Ember is out
  sfx('item');
  await narrate('Gerald coughed up the Ember of Wickhollow! It\'s warm, and only a little bit slimy.');
  await say('Gerald', '...Can I at least come visit it sometimes?');
  const c = await choose(['Of course!', 'No.']);
  G.flags.geraldFriend = c === 0;
  if (c === 0) await say('Gerald', 'Really?! I\'ll bring snacks! Not lamps. Different snacks.');
  else await say('Gerald', '...That\'s fair. I\'ll go think about my choices. On a streetlight. KIDDING. Mostly.');
  gerald.fly = 1;
  for (let i = 0; i < 6; i++) setTimeout(() => sfx('flap'), i * 220);
  await wait(2.2);
  g.visible = false; gerald.fly = 0;
  await say('Moss', 'Well. That was a lot of moth.');
  await say('Moss', 'Let\'s go home, Lantern Keeper. Before my eyeliner wears off.');
  await relightScene();
}

const SPOTS = { mayor: [-2.3, 2.15], baker: [2.5, 2.35], tobin: [-3.5, 3.1], zuzu: [3.7, 1.9], fenwick: [4.5, 3.0], barnaby: [-4.5, 1.6], glen: [-1.3, 3.75], biscuit: [1.5, 3.55], wendell: [5.6, 1.2], odo: [-3.0, 4.05], cat: [-6.2, 3.2] };
async function relightScene() {
  A.gerald.mat.emissiveIntensity = 0.12;
  await fadeTo(1, 1.2);
  audio.stopMusic();
  G.cineTarget = 0;
  setArea('town');
  A.gerald.visible = false; gerald.fly = 0;
  await narrate('Later, back in Wickhollow...');
  for (const n of npcs) {
    const sp = SPOTS[n.id]; if (!sp) continue;
    const a = n.actor;
    a.x = sp[0]; a.z = sp[1]; n.wander = 0; a.moving = false; a.visible = true;
    if (n.four) a.dir = 'down';
  }
  npc('moss').joined = true;
  follower.active = true;
  Object.assign(A.pip, { x: 0.0, z: 2.95, dir: 'up', moving: false });
  Object.assign(A.moss, { x: 0.95, z: 3.2, dir: 'up', moving: false, visible: true });
  trail.length = 0;
  heroCam(true, 2.55);
  await fadeTo(0, 1.4);
  await say('Mayor Bramblewick', 'Citizens of Wickhollow! Our young Keeper has returned with the flame!');
  await say('Mayor Bramblewick', 'I\'d like to say a few words. Ahem. In the year seventeen-twenty-four, a humble candlemaker named—');
  await say('Moss', 'Just light it.');
  await say('Mayor Bramblewick', '...Right. Yes. Light it, Pip!');
  await say('Grandpa Odo', 'Go on, Pip. Just like I showed you. Except I never showed you. Put it in the top bit.');
  await walkPlayer(0, 1.95);
  await wait(0.3);
  // the ember floats up out of Pip's lantern and into the cage
  const L = GREAT_LANTERN_LIGHT;
  await new Promise(res => {
    const p0 = new THREE.Vector3(A.pip.x + 0.22, A.pip.ground(A.pip.x, A.pip.z) + 0.45, A.pip.z + 0.1);
    ember = { p0, p1: new THREE.Vector3(L.x, L.y, L.z), t: 0, dur: 1.8, res };
    A.emberSprite.visible = true;
  });
  A.emberSprite.visible = false;
  sfx('ignite');
  audio.play('fanfare');
  G.flash = 1; G.shake = 5;
  const ls = toScreenV(L.x, L.y, L.z);
  rings.push({ x: ls[0], y: ls[1], t: 0, life: 1.6 }, { x: ls[0], y: ls[1], t: -0.25, life: 1.8 });
  for (let i = 0; i < 90; i++) ofx.push({ x: ls[0], y: ls[1], vx: rand(-360, 360) * V.S / 3, vy: rand(-400, 100) * V.S / 3, g: 180 * V.S / 3, life: rand(0.8, 1.6), t: 0, col: pick([[255, 230, 140], [255, 170, 80], [255, 255, 230]]), s: rand(1, 2.4) });
  // the town relights over ~3 s, lamps lighting in a ripple outward from the lantern
  const t0 = performance.now();
  while (G.lanternK < 1) { G.lanternK = Math.min(1, (performance.now() - t0) / 3000); await wait(0.03); }
  G.lit = true;
  fireworks(6);
  await wait(1.6);
  await say('Mayor Bramblewick', 'Magnificent! Wickhollow shines again!');
  await say('Mrs. Pennywhistle', 'My ovens! I can hear them warming up! Cinnamon buns for everyone!');
  await say('Moss', '...Okay. That was kind of beautiful. Don\'t tell anyone I said that.');
  await say('Grandpa Odo', 'Well done, Lantern Keeper. You can have the job permanently. Still unpaid.');
  await say('Tobin', 'And I guarded the town the WHOLE time! With my stick!');
  // a familiar silhouette on a rooftop
  const g = A.gerald;
  Object.assign(g, { x: -4.3, z: -14.0, lift: 6.55, ground: groundY }); g.visible = true; gerald.onRoof = true;
  Object.assign(camState, { ty: 4.6, wantPitch: 6 });
  await wait(1.2);
  await say('Gerald', 'So pretty...');
  await say('Moss', '...He\'s on the roof.');
  await say('Mayor Bramblewick', 'Is that a MOTH on my ROOF?');
  if (G.flags.geraldFriend) await say('Gerald', 'Hi! I brought snacks! As promised! They\'re mostly lint!');
  else await say('Gerald', 'I\'m just visiting! From up here! Legally!');
  fireworks(4);
  await wait(1.2);
  await fadeTo(1, 1.6);
  G.mode = 'ending'; G.endingT = 0; G.cineTarget = 0;
  heroCam(true);
  Object.assign(camState, { ty: 3.9 });
  await fadeTo(0, 1.2);
}
function fireworks(n) {
  for (let k = 0; k < n; k++) setTimeout(() => {
    const x = V.W * rand(0.15, 0.85), y = V.H * rand(0.08, 0.32);
    const col = pick([[255, 120, 160], [120, 220, 255], [255, 220, 120], [180, 140, 255], [140, 255, 170]]);
    sfx('lampon');
    for (let i = 0; i < 46; i++) { const a = rand(0, TAU), s = rand(40, 80) * V.S; ofx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 40 * V.S, drag: 0.97, life: rand(0.9, 1.5), t: 0, col, s: 1.2 }); }
  }, k * 450 + rand(0, 200));
}

// ---------------- title & ending ----------------
function toTitle() {
  G.mode = 'title'; G.titleT = 0;
  G.battle = null; G.dlg = null; G.choiceBox = null; G.menuOpen = null; G.scriptBusy = false;
  resetState();
  heroCam(true);
  audio.play('title');
  G.fade.a = 1; G.fade.target = 0; G.fade.speed = 1;
}
function updateTitle(dt) {
  G.titleT += dt;
  heroCam(false);
  camState.tx = 0.2 + Math.sin(G.titleT * 0.08) * 1.6;
  camState.ty = 3.3 + Math.sin(G.titleT * 0.05) * 0.3;
  for (const n of npcs) n.actor.update(dt);
  A.pip.update(dt);
  if ((pressed.a || pressed.tap) && G.titleT > 0.6 && G.fade.a < 0.5) {
    sfx('ok');
    pressed.a = pressed.tap = false;
    runScript(async () => {
      await fadeTo(1, 0.8);
      resetState();
      G.mode = 'field';
      await introScene();
    });
  }
}
function updateEnding(dt) {
  G.endingT += dt;
  camState.tx = 0.2 + Math.sin(G.endingT * 0.1) * 2.5;
  if (Math.random() < dt * 0.8) fireworks(1);
  for (const n of npcs) n.actor.update(dt);
  A.pip.update(dt); A.moss.update(dt); if (A.gerald.visible) { A.gerald.bob = Math.sin(G.t * 2) * 0.07; A.gerald.update(dt); }
  if ((pressed.a || pressed.tap) && G.endingT > 3) { pressed.a = pressed.tap = false; runScript(async () => { await fadeTo(1, 1); toTitle(); }); }
}

// ---------------- per-frame ----------------
const _p = new THREE.Vector3();
function toScreenV(x, y, z) { _p.set(x, y, z).project(camera); return [(_p.x + 1) / 2 * V.W, (1 - _p.y) / 2 * V.H, _p.z]; }
function toScreen(a, v = 1) { a.anchor(_p, v); _p.project(camera); return [(_p.x + 1) / 2 * V.W, (1 - _p.y) / 2 * V.H, _p.z]; }

let lastLanternK = -1;
export function update(dt) {
  G.t += dt;
  pollInput(dt);
  updateTimers(dt);
  updateDialog(dt);
  updateMenu();
  if (G.mode === 'title') updateTitle(dt);
  else if (G.mode === 'field') updateField(dt);
  else if (G.mode === 'battle' && G.battle) { updateBattle(dt); A.gerald.bob = 0; }
  else if (G.mode === 'ending') updateEnding(dt);
  // Pip's hand lantern pool + Gerald's tummy glow
  const P = A.pip;
  pipPool.pos.set(P.x + 0.25, P.ground(P.x, P.z) + 0.6, P.z + 0.2);
  pipPool.intensity = A.pip.visible ? 1.5 : 0;
  LIGHT.extra[0].x = P.x + 0.25; LIGHT.extra[0].z = P.z + 0.2;
  const g = A.gerald;
  const gOn = g.visible && gerald.ember !== false && G.area === 'forest';
  g.anchor(gerald.pool.pos, 0.3);
  gerald.pool.intensity = gOn ? 6.5 : 0;
  LIGHT.extra[1].on = gOn; LIGHT.extra[1].x = g.x; LIGHT.extra[1].z = g.z;
  // lantern level (lamps ripple on during the relight)
  if (G.lanternK !== lastLanternK || lanternLevelImpl() === 'stub') {
    setLanternLevel(ctx, G.lanternK);
    for (const l of lampOrder) {
      if (!l.on && G.lanternK > l.th + 0.04) {
        l.on = true;
        if (G.mode !== 'title') {
          sfx('lampon');
          const s = toScreenV(l.x, l.y, l.z);
          for (let i = 0; i < 14; i++) ofx.push({ x: s[0], y: s[1], vx: rand(-60, 60) * V.S / 2, vy: rand(-70, 15) * V.S / 2, g: 60 * V.S / 2, life: rand(0.4, 0.8), t: 0, col: [255, 220, 150], s: 1.2 });
        }
      }
    }
    lastLanternK = G.lanternK;
  }
  // ember flight
  if (ember) {
    ember.t += dt / ember.dur;
    const k = smooth(Math.min(1, ember.t));
    const e = A.emberSprite.position.lerpVectors(ember.p0, ember.p1, k);
    e.y += Math.sin(k * Math.PI) * 1.6;
    A.emberSprite.scale.setScalar(0.55 + 0.15 * Math.sin(G.t * 20));
    if (Math.random() < 0.9) { const s = toScreenV(e.x, e.y, e.z); ofx.push({ x: s[0] + rand(-3, 3), y: s[1] + rand(-3, 3), vx: rand(-15, 15) * V.S, vy: rand(-15, 15) * V.S, g: 0, life: rand(0.4, 0.8), t: 0, col: pick([[255, 230, 140], [255, 170, 80]]), s: 1.4 }); }
    if (ember.t >= 1) { const r = ember.res; ember = null; r(); }
  }
  for (let i = ofx.length - 1; i >= 0; i--) {
    const f = ofx[i];
    f.t += dt;
    if (f.t > f.life) { ofx.splice(i, 1); continue; }
    if (f.drag) { f.vx *= Math.pow(f.drag, dt * 60); f.vy *= Math.pow(f.drag, dt * 60); }
    f.vy += (f.g || 0) * dt; f.x += f.vx * dt; f.y += f.vy * dt;
  }
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > rings[i].life) rings.splice(i, 1); }
  G.shake = Math.max(0, G.shake - dt * 6);
  G.flash = Math.max(0, G.flash - dt * 0.8);
  if (G.mode !== 'battle') camState.shake = G.shake;
  placeCamera(camera, camState, dt);
  const hero = G.mode === 'title' || G.mode === 'ending' || camState.focusOverride;
  // occluders: tall sprites standing between the camera and the action are hidden while they
  // would cover it (town: only the foreground framing trees; forest / battle: anything in front)
  const inBattle = G.mode === 'battle' && G.battle;
  const refZ = inBattle ? G.battle.cz + 1.6 : A.pip.z + 2.4;
  for (const f of fgTrees) {
    if (hero) { f.o.visible = true; continue; }
    if (f.forest !== (G.area === 'forest')) continue;
    if (f.forest && f.p.z < refZ + (f.h < 3 ? 1.2 : 0)) { f.o.visible = true; continue; }
    if (Math.abs(f.p.x - camera.position.x) > 30) continue;
    // the sprite's horizontal extent on screen, tested against the middle of the frame
    _p.set(f.p.x - f.w * 0.4, f.p.y + f.h * 0.5, f.p.z).project(camera);
    const xa = _p.x, za = _p.z;
    _p.set(f.p.x + f.w * 0.4, f.p.y + f.h * 0.5, f.p.z).project(camera);
    const lim = inBattle ? 0.98 : 0.9;
    f.o.visible = za > 1 || xa > lim || _p.x < -lim;
  }
}

// focus distance for the DOF: the player in the field, the stage in battle, fixed for hero shots
export function focusInfo() {
  if (camState.focusOverride) return { focus: camState.focusOverride, range: camState.range, aperture: camState.aperture };
  if (G.mode === 'battle' && G.battle) { _p.set(G.battle.cx, camState.y, G.battle.cz); }
  else if (camState.lock) _p.set(camState.x, camState.y, camState.z);
  else { A.pip.anchor(_p, 0.5); }
  return { focus: camera.position.distanceTo(_p), range: camState.range, aperture: camState.aperture };
}

export function hazeCtx() { return G.area === 'forest' ? { hazeLights: forestFx.haze } : ctx; }

export function drawOverlay() {
  clearHits();
  D.setTransform(1, 0, 0, 1, 0, 0);
  D.clearRect(0, 0, V.W, V.H);
  if (touch.ui && V.H > V.W * 1.05) { drawRotate(); clearPressed(); return; }
  if (G.mode === 'battle' && G.battle) drawBattle();
  // rings & overlay sparks (ember trail, lamp sparkles, fireworks)
  D.globalCompositeOperation = 'lighter';
  for (const r of rings) {
    if (r.t < 0) continue;
    const k = r.t / r.life, rad = (1 - (1 - k) * (1 - k)) * 150 * V.S;
    D.strokeStyle = `rgba(255,190,110,${(1 - k) * 0.5})`;
    D.lineWidth = (1 - k) * 6 * V.S;
    D.beginPath(); D.ellipse(r.x, r.y, rad, rad * 0.6, 0, 0, TAU); D.stroke();
  }
  for (const f of ofx) {
    const a = Math.min(1, (1 - f.t / f.life) * 1.5);
    D.fillStyle = `rgba(${f.col[0]},${f.col[1]},${f.col[2]},${a})`;
    const s = (f.s || 1) * V.S;
    D.fillRect(f.x - s / 2, f.y - s / 2, s, s);
  }
  D.globalCompositeOperation = 'source-over';
  if (G.flash > 0) { D.fillStyle = `rgba(255,236,200,${Math.min(0.85, G.flash)})`; D.fillRect(0, 0, V.W, V.H); }
  // talk bubble over the NPC Pip is facing; "!" over alerted monsters
  if (G.mode === 'field' && !blocking()) {
    const t = G.target;
    if (t && t.n) { const s = toScreen(t.n.actor, t.n.lying ? 1.4 : 1.12); drawBubble(s[0], s[1], '…'); }
    if (G.area === 'forest') for (const en of enemiesOnMap) if (en.alive && en.alert > 0.5) { const s = toScreen(en.actor, 1.15); drawBubble(s[0], s[1], '!'); }
  }
  if (G.mode === 'title') drawTitle();
  if (G.mode === 'ending') drawEnding();
  drawCine();
  if (G.mode === 'field') drawControls();
  drawFade();
  drawDialog();
  drawMenu();
  clearPressed();
}

// ---------------- boot / debug scenes ----------------
export function startGame() {
  mountUI();
  resetState();
  const scene = qs.get('scene');
  if (scene) debugScene(scene);
  else toTitle();
}
function debugScene(s) {
  G.mode = 'field';
  G.fade.a = 0; G.fade.target = 0;
  G.flags.intro = true;
  const joinMoss = () => {
    G.flags.mayor = G.flags.moss = true; party[1].joined = true; follower.active = true; npc('moss').joined = true; GATE.open = true; gateAnim = 1; inventory.cookie = 3;
  };
  if (s === 'town') { Object.assign(A.pip, { x: 0, z: 2.6, dir: 'up' }); }
  if (s === 'gate') { joinMoss(); GATE.open = false; gateAnim = 0; Object.assign(A.pip, { x: 17.5, z: -0.1, dir: 'right' }); }
  if (s === 'forest' || s === 'boss' || s === 'battle' || s === 'bossfight') {
    joinMoss(); G.flags.forestIntro = true;
    setArea('forest');
    const lx = s === 'boss' ? 31 : 1.2;
    Object.assign(A.pip, { x: FOREST.x0 + lx, z: FOREST.z0 + pathZ(lx), dir: 'right' });
    Object.assign(A.moss, { x: A.pip.x - 0.8, z: A.pip.z, dir: 'right' });
  }
  if (s === 'battle') runScript(() => encounter(enemiesOnMap[0]));
  if (s === 'bossfight') { G.flags.gerald = true; Object.assign(A.pip, { x: FOREST.x0 + 36, z: FOREST.z0 }); runScript(bossFight); }
  if (s === 'relight') { joinMoss(); G.flags.gerald = true; A.gerald.visible = false; runScript(relightScene); }
  if (s === 'ending') { joinMoss(); G.lanternK = 1; G.lit = true; for (const n of npcs) { const sp = SPOTS[n.id]; if (sp) { n.actor.x = sp[0]; n.actor.z = sp[1]; n.wander = 0; } } Object.assign(A.pip, { x: 0, z: 2.3, dir: 'up' }); Object.assign(A.moss, { x: 0.95, z: 3.2, dir: 'up' }); Object.assign(A.gerald, { x: -4.3, z: -14.0, lift: 6.55, ground: groundY }); A.gerald.mat.emissiveIntensity = 0.12; G.mode = 'ending'; G.endingT = 0; heroCam(true); }
  if (s === 'title') { toTitle(); return; }
  if (G.mode === 'field' && !camState.lock) snapCamToPlayer();
  audio.play(G.area === 'forest' ? 'forest' : 'town');
}

// ---------------- test hooks ----------------
window.LK = {
  get mode() { return G.mode; },
  get area() { return G.area; },
  get dlg() { return G.dlg && G.dlg.text; },
  get speaker() { return G.dlg && G.dlg.name; },
  get busy() { return G.scriptBusy; },
  get choice() { return G.choiceBox ? G.choiceBox.opts.slice() : null; },
  get menu() { return G.battle && G.battle.menu && G.battle.menu.stage; },
  get fade() { return G.fade.a; },
  get lantern() { return G.lanternK; },
  get lanternImpl() { return lanternLevelImpl(); },
  get player() { const P = A.pip; return { x: +P.x.toFixed(3), z: +P.z.toFixed(3), y: +P.ground(P.x, P.z).toFixed(3), dir: P.dir, moving: P.moving, area: G.area, lx: G.area === 'forest' ? +(P.x - FOREST.x0).toFixed(3) : undefined }; },
  get follower() { return follower.active ? { x: A.moss.x, z: A.moss.z } : null; },
  get target() { const t = G.target; return t ? (t.n ? t.n.id : t.c.id) : null; },
  get gateOpen() { return GATE.open; },
  get battleState() {
    const b = G.battle; if (!b) return null;
    return { round: b.round, actor: b.actor && b.actor.id, menu: b.menu && b.menu.stage, boost: b.boost, msg: b.msgT > 0 ? b.msg : '', bp: { ...b.bp },
      enemies: b.enemies.map(e => ({ kind: e.kind, name: e.name, hp: e.hp, maxHp: e.maxHp, shield: e.shield, broken: !!e.broken, alive: e.alive, known: { ...e.known } })),
      party: b.active.map(p => ({ id: p.id, hp: p.hp, sp: p.sp })) };
  },
  battle: () => G.battle,
  flags: G.flags, party, inventory, stats: G.stats, enemiesOnMap, npcs, G, A, FOREST,
  // walkability grid dump for automated path-finding tests
  grid(area, x0, z0, x1, z1, step) {
    const out = [], g = groundOf(area);
    for (let z = z0; z <= z1 + 1e-6; z += step) { const row = []; for (let x = x0; x <= x1 + 1e-6; x += step) row.push(blockedStatic(area, x + 0.013, z + 0.013) ? -99 : +g(x + 0.013, z + 0.013).toFixed(2)); out.push(row); }
    return out;
  },
  teleport(x, z, area) { if (area && area !== G.area) setArea(area); A.pip.x = x; A.pip.z = z; A.moss.x = x - 0.9; A.moss.z = z; trail.length = 0; snapCamToPlayer(); },
};
