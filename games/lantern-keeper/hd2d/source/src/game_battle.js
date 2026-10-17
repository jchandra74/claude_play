// Turn-based battle with Weakness / Break / Boost, ported from the original 2D game and staged in
// the 3D world: monsters line up on the left of the spot where the encounter happened, the party on
// the right facing them, the camera drops into a closer, shallower-focus battle framing so the field
// behind melts into bokeh. Monsters and party are the same lit billboard actors as the field.
// Damage pops, sparks, break shards, the pixel dissolve and all menus are drawn on the 2D overlay at
// each actor's projected screen position.
import * as THREE from 'three';
import { G, party, ITEMS, inventory, wait, say, narrate, fadeTo } from './game_state.js';
import { audio, sfx } from './game_audio.js';
import { V, D, safe, panel, text, bar, rr, font, hits, pressed, clearPressed, UIC, TAU, clamp, easeOutBack, touch } from './game_ui.js';
import { ICONS } from './game_art.js';
import { frame, frameCanvas } from './game_tex.js';
import { camState, CAMS } from './game_world.js';

const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const css = (c, al = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;

const TYPES = ['broom', 'sling', 'fire', 'sass'];
const TYPE_NAME = { broom: 'Broom', sling: 'Sling', fire: 'Fire', sass: 'Sass' };
const ENEMY_DEFS = {
  // tuned so a normal fight lasts 3-5 rounds and wants one Break; Gerald needs two Breaks, Boosts and
  // healing, and can win if the party ignores his wind-ups
  shrub: { name: 'Smug Shrub', hp: 340, atk: 18, def: 5, spd: 8, shield: 3, weak: ['fire', 'broom'], exp: 14,
    moves: [{ name: 'Leaf Flick', power: 1.0, w: 3 }, { name: 'Condescending Look', power: 0.85, w: 2, line: '{e} looks at {t} condescendingly. {t}\'s self-esteem took a hit!' }] },
  moth: { name: 'Lil\' Mothling', hp: 210, atk: 14, def: 4, spd: 14, shield: 3, weak: ['sling', 'sass'], exp: 12,
    moves: [{ name: 'Dust Puff', power: 1.0, w: 3 }, { name: 'Flutter', power: 0, w: 1, line: '{e} flutters menacingly. It isn\'t very menacing.' }] },
  gerald: { name: 'Gerald', hp: 2200, atk: 21, def: 9, spd: 11, shield: 6, weak: ['broom', 'sass'], absorb: 'fire', boss: true, exp: 120,
    moves: [{ name: 'Wing Slap', power: 1.2, w: 3 }, { name: 'Lamp Hug', heal: 150, w: 1, line: '{e} hugs himself like a lamp. Recovered {n} HP!' }, { name: 'Monologue', power: 0, w: 1, line: '{e} talks about his feelings. Nobody knows what to do with their hands.' }] },
};

let E = null;
const BOOST_MUL = [1, 1.7, 2.4, 3.1];     // skill power per Boost level (attacks get +1 hit per level)
export const STAGE_POOLS = [
  { pos: new THREE.Vector3(), color: new THREE.Color(0.55, 0.5, 1.0), intensity: 0, radius: 5.2, core: 0.6, prio: -1, seed: null, weight: 9 },
  { pos: new THREE.Vector3(), color: new THREE.Color(1, 0.75, 0.5), intensity: 0, radius: 4.6, core: 0.6, prio: -1, seed: null, weight: 9 },
];      // env from the game: { ctx, camera, pip, moss, enemies: { shrub:[], moth:[], gerald:[] }, ground }
export function initBattle(env) { E = env; }
export function battleState() { return G.battle; }

function makeEnemy(kind, i, n) {
  const d = ENEMY_DEFS[kind];
  return {
    kind, name: d.name + (n > 1 && !d.boss ? ' ' + 'AB'[i] : ''), hp: d.hp, maxHp: d.hp, atk: d.atk, def: d.def, spd: d.spd,
    shield: d.shield, maxShield: d.shield, weak: d.weak, absorb: d.absorb, known: {}, def0: d,
    broken: 0, alive: true, flash: 0, shake: 0, x: 0, y: 0, top: 0, w: 0, dying: 0, ph: Math.random() * 9,
    telegraph: false, enraged: false, step: 0, actor: null,
  };
}

const _v = new THREE.Vector3();
function project(p) {
  _v.copy(p).project(E.camera);
  return [(_v.x + 1) / 2 * V.W / V.S, (1 - _v.y) / 2 * V.H / V.S];
}

// ---------- staging ----------
function stage(b) {
  const cx = b.cx, cz = b.cz;
  const n = b.enemies.length;
  b.enemies.forEach((e, i) => {
    const pool = E.enemies[e.kind];
    const a = pool[Math.min(i, pool.length - 1)];
    // two of the same kind use different actors
    const used = b.enemies.slice(0, i).filter(o => o.kind === e.kind).length;
    e.actor = pool[used] || a;
    e.saved = { x: e.actor.x, z: e.actor.z, lift: e.actor.lift, visible: e.actor.visible, ground: e.actor.ground };
    const big = e.kind === 'gerald';
    // a staggered diagonal: the back monster up-left, the front one down-right, never overlapping
    e.hx = big ? cx - 3.2 : cx - (n === 1 ? 2.6 : (i % 2 ? 2.0 : 4.3));
    e.hz = big ? cz - 1.0 : cz + (n === 1 ? 0 : (i % 2 ? 0.95 : -1.05));
    const A = e.actor;
    A.ground = E.ground; A.x = e.hx; A.z = e.hz; A.visible = true; A.dir = 'right'; A.U.uFade.value = 0; A.tilt = 0;
    A.lift = e.kind === 'moth' ? 0.6 : big ? 0.45 : 0;
  });
  b.active.forEach((p, i) => {
    const A = p.id === 'pip' ? E.pip : E.moss;
    p.actor = A;
    // Pip in front (nearest the camera), Moss behind and to the right: Octopath's stepped party line
    p.hx = cx + 2.3 + i * 1.65; p.hz = cz + 1.0 - i * 1.9;
    A.x = p.hx; A.z = p.hz; A.dir = 'left'; A.visible = true; A.tilt = 0; A.ox = A.oz = 0;
  });
}
function unstage(b) {
  for (const e of b.enemies) {
    const A = e.actor; if (!A) continue;
    Object.assign(A, { x: e.saved.x, z: e.saved.z, lift: e.saved.lift, ground: e.saved.ground, ox: 0, oz: 0, tilt: 0, bob: 0 });
    A.visible = e.saved.visible; A.U.uFade.value = 0; A.U.uFlash.value.w = 0;
  }
  for (const p of b.active) { const A = p.actor; A.ox = A.oz = 0; A.tilt = 0; A.U.uFlash.value.w = 0; A.U.uFade.value = 0; A.moving = false; }
}

// ---------- start ----------
export function startBattle(kinds, opts = {}) {
  return new Promise(res => {
    // "A" / "B" only tell apart two of the same kind
    const enemies = kinds.map((k, i) => makeEnemy(k, kinds.slice(0, i).filter(o => o === k).length, kinds.filter(o => o === k).length));
    const b = G.battle = {
      enemies, opts, res, round: 0, order: [], actor: null, menu: null, boost: 0, msg: '', msgT: 0,
      pops: [], fx: [], t: 0, intro: 1, shake: 0, flash: 0, breakFx: 0, dust: 0,
      bp: {}, boosted: {}, active: party.filter(p => p.joined), cx: opts.cx, cz: opts.cz, orderIdx: 0,
    };
    for (const p of b.active) { b.bp[p.id] = 1; b.boosted[p.id] = false; if (p.hp <= 0) p.hp = 1; p.defending = false; p.step = 0; p.hurt = 0; }
    stage(b);
    // stage lighting: a cool (or, for Gerald, hot) pool on the monsters and a warm one on the party
    const gy = E.ground(b.cx, b.cz);
    // (the two stage pools are pre-allocated at the front of ctx.pools; the pool list never changes shape)
    const [pA, pB] = STAGE_POOLS;
    pA.pos.set(b.cx - 2.8, gy + 2.4, b.cz + 1.4); pA.color.set(opts.boss ? 0xff8c4d : 0xa59cf0); pA.intensity = opts.boss ? 4 : 2.0;
    pB.pos.set(b.cx + 3.0, gy + 2.2, b.cz + 1.6); pB.intensity = 3.5;
    // camera: battle framing round the stage centre
    const C = opts.boss ? { ...CAMS.battle, dist: CAMS.battle.dist + 1.5, lift: CAMS.battle.lift + 0.5 } : CAMS.battle;
    Object.assign(camState, { tx: b.cx + 0.1, ty: gy + C.lift, tz: b.cz, wantDist: C.dist, wantPitch: C.pitch, wantYaw: C.yaw, fov: C.fov, range: C.range, aperture: C.aperture, lock: true, focusOverride: null });
    Object.assign(camState, { x: camState.tx, y: camState.ty, z: camState.tz, dist: C.dist, pitch: C.pitch, yaw: C.yaw, fovNow: C.fov });
    G.mode = 'battle';
    audio.play(opts.boss ? 'boss' : 'battle');
    runBattle().then(async r => {
      b.over = true;
      await fadeTo(1, 0.35);
      unstage(b);
      for (const p of STAGE_POOLS) p.intensity = 0;
      res(r);
    });
  });
}

function bmsg(s, t = 1.4) { G.battle.msg = s; G.battle.msgT = t; }
function pop(x, y, str, col = '#fff', big = false) { G.battle.pops.push({ x, y, str, col, t: 0, big }); }
const aliveEnemies = () => G.battle.enemies.filter(e => e.alive);
const aliveParty = () => G.battle.active.filter(p => p.hp > 0);
const mid = e => (e.y + e.top) / 2;

async function runBattle() {
  const b = G.battle;
  await wait(0.9);
  bmsg(b.enemies.length > 1 ? `${b.enemies.length} monsters block the way!` : (b.opts.boss ? 'Gerald, the Moth of Unusual Size, wants to fight! Probably!' : `A ${b.enemies[0].name} appears! It looks pleased with itself.`), 1.8);
  await wait(1.6);
  if (b.opts.tutorial) await battleTutorial();
  while (true) {
    b.round++;
    for (const e of aliveEnemies()) {
      if (e.broken && b.round > e.brokenUntil) { e.broken = 0; e.shield = e.maxShield; pop(e.x, e.top - 6, 'RECOVERED', '#9ad0ff'); }
    }
    const actors = [...aliveParty(), ...aliveEnemies()].map(a => ({ a, s: a.spd + Math.random() * 4 }));
    actors.sort((x, y) => y.s - x.s);
    // the tutorial lets Pip (who has the shrub's weaknesses) open the fight
    if (b.opts.tutorial && b.round === 1) actors.sort((x, y) => (y.a.id === 'pip') - (x.a.id === 'pip'));
    b.order = actors.map(x => x.a);
    for (let oi = 0; oi < b.order.length; oi++) {
      const a = b.order[oi];
      b.orderIdx = oi;
      if (a.hp <= 0 || a.alive === false) continue;
      if (party.includes(a)) {
        if (!aliveEnemies().length) break;
        b.actor = a;
        if (!b.boosted[a.id]) b.bp[a.id] = Math.min(5, b.bp[a.id] + 1);
        b.boosted[a.id] = false;
        const act = await chooseAction(a);
        b.actor = a;
        if (act.kind === 'flee') {
          if (b.opts.boss) { bmsg('Gerald is blocking the way with his enormous fluff.'); await wait(1.3); }
          else { bmsg('You ran away! Very gracefully.'); sfx('whoosh'); await wait(1.1); b.actor = null; return 'flee'; }
        } else await doPartyAction(a, act);
        b.actor = null;
      } else {
        if (a.broken) continue;
        await enemyTurn(a);
      }
      if (!aliveEnemies().length || !aliveParty().length) break;
    }
    if (!aliveEnemies().length) { await wait(0.6); return await victory(); }
    if (!aliveParty().length) { bmsg('The party is out cold...', 2); await wait(2); return 'lose'; }
  }
}

async function battleTutorial() {
  await say('Moss', 'Okay. Quick lesson, because you look lost.');
  await say('Moss', 'Every monster has weak spots. Those little boxes under it. Hit a weakness and its shield number goes down.');
  await say('Moss', 'Get the shield to zero and it BREAKS. Broken monsters skip their turn and take double damage. I didn\'t name it.');
  await say('Moss', 'You also build Boost Points every turn. Tap BOOST (or press E) before you act to spend them on extra hits or stronger skills.');
  await say('Moss', 'Shrubs hate brooms and fire. That\'s you, Pip: your Broom, or Flicker from Skills. Shrubs hate everything, honestly.');
  await say('Moss', 'My slingshot just annoys it. I\'ll do damage while you break it. Then we both hit it while it\'s dizzy.');
}

// ---------- player input ----------
function chooseAction(a) {
  return new Promise(res => {
    G.battle.boost = 0;
    G.battle.menu = { stage: 'cmd', sel: 0, actor: a, res, tsel: 0, sel2: 0 };
    sfx('move');
  });
}
const battleCommands = a => [{ label: 'Attack', sub: TYPE_NAME[a.weapon] }, { label: 'Skills', sub: '' }, { label: 'Items', sub: '' }, { label: 'Defend', sub: '' }, { label: 'Run', sub: '' }];
function updateBattleInput() {
  const b = G.battle, m = b && b.menu;
  if (!m || G.dlg) return;
  const a = m.actor;
  if (pressed.boostUp) boostChange(1);
  if (pressed.boostDown) boostChange(-1);
  if (m.stage === 'cmd') {
    const n = 5;
    if (pressed.up) { m.sel = (m.sel + n - 1) % n; sfx('move'); }
    if (pressed.down) { m.sel = (m.sel + 1) % n; sfx('move'); }
    if (pressed.a) pickCmd(m.sel);
  } else if (m.stage === 'skill' || m.stage === 'item') {
    const list = m.stage === 'skill' ? a.skills : itemList();
    const n = list.length;
    if (n) {
      if (pressed.up) { m.sel2 = (m.sel2 + n - 1) % n; sfx('move'); }
      if (pressed.down) { m.sel2 = (m.sel2 + 1) % n; sfx('move'); }
      if (pressed.a) pickSub(m.sel2);
    }
    if (pressed.b) { m.stage = 'cmd'; sfx('back'); }
  } else if (m.stage === 'target') {
    const tl = targetList(), n = tl.length;
    if (pressed.left || pressed.up) { m.tsel = (m.tsel + n - 1) % n; sfx('move'); }
    if (pressed.right || pressed.down) { m.tsel = (m.tsel + 1) % n; sfx('move'); }
    if (pressed.a) pickTarget(m.tsel);
    if (pressed.b) { m.stage = m.prev || 'cmd'; m.allyT = false; sfx('back'); }
  }
  clearPressed();
}
function boostChange(d) {
  const b = G.battle, m = b.menu;
  if (!m) return;
  const a = m.actor, max = Math.min(3, b.bp[a.id]);
  const nb = clamp(b.boost + d, 0, max);
  if (d > 0 && nb === b.boost && max > 0) { b.boost = 0; sfx('back'); return; }
  if (nb !== b.boost) { b.boost = nb; if (d > 0) sfx('boost', 1 + nb * 0.25); else sfx('back'); }
  else sfx('bump');
}
const itemList = () => Object.keys(ITEMS).filter(k => inventory[k] > 0);
function pickCmd(i) {
  const m = G.battle.menu;
  m.sel = i;
  if (i === 0) { m.action = { kind: 'attack' }; m.prev = 'cmd'; m.stage = 'target'; m.allyT = false; m.tsel = 0; sfx('ok'); }
  else if (i === 1) { m.stage = 'skill'; m.sel2 = 0; sfx('ok'); }
  else if (i === 2) { if (!itemList().length) { sfx('bump'); bmsg('No items left. Your pockets echo.', 1.2); return; } m.stage = 'item'; m.sel2 = 0; sfx('ok'); }
  else if (i === 3) finish({ kind: 'defend' });
  else if (i === 4) finish({ kind: 'flee' });
}
function pickSub(i) {
  const m = G.battle.menu, a = m.actor;
  m.sel2 = i;
  if (m.stage === 'skill') {
    const sk = a.skills[i];
    if (a.sp < sk.sp) { sfx('bump'); bmsg('Not enough SP.', 1); return; }
    m.action = { kind: 'skill', skill: sk };
    if (sk.target === 'one') { m.prev = 'skill'; m.stage = 'target'; m.tsel = 0; m.allyT = false; }
    else if (sk.target === 'ally') { m.prev = 'skill'; m.stage = 'target'; m.tsel = 0; m.allyT = true; }
    else finish(m.action);
    sfx('ok');
  } else {
    const key = itemList()[i], it = ITEMS[key];
    m.action = { kind: 'item', key };
    if (it.target === 'ally') { m.prev = 'item'; m.stage = 'target'; m.tsel = 0; m.allyT = true; }
    else finish(m.action);
    sfx('ok');
  }
}
function targetList() { const m = G.battle.menu; return m.allyT ? G.battle.active.filter(p => p.hp > 0) : aliveEnemies(); }
function pickTarget(i) {
  const m = G.battle.menu, tl = targetList();
  if (!tl[i]) return;
  m.action.target = tl[i];
  sfx('ok');
  finish(m.action);
}
function finish(action) {
  const b = G.battle, m = b.menu;
  action.boost = b.boost;
  b.menu = null;
  m.res(action);
}

// ---------- resolving actions ----------
function calcDmg(attacker, target, power, stat, type) {
  const st = attacker[stat || 'atk'];
  let d = (st * 2.3 * power - target.def) * rand(0.9, 1.1);
  if (target.broken) d *= 2;
  if (target.weak && target.weak.includes(type)) d *= 1.3;
  if (target.defending) d *= 0.5;
  return Math.max(1, Math.round(d));
}
async function stepForward(a) { a.step = 1; await wait(0.18); }

async function hitEnemy(a, e, power, stat, type, boostMul) {
  if (!e.alive) return;
  const b = G.battle;
  const isWeak = e.weak.includes(type);
  if (e.absorb === type) {
    const heal = Math.round(a[stat] * 2 * power * boostMul);
    e.hp = Math.min(e.maxHp, e.hp + heal);
    pop(e.x, e.top + 4, '+' + heal, UIC.green, true);
    pop(e.x, e.top - 8, 'ABSORBED', '#ffb04a');
    e.known[type] = 'absorb';
    sfx('fire');
    return;
  }
  const dmg = calcDmg(a, e, power * boostMul, stat, type);
  e.hp -= dmg;
  e.flash = 0.15; e.shake = 0.3;
  b.shake = isWeak ? 3 : 1.5;
  spawnHitFx(e, type, isWeak);
  pop(e.x + rand(-8, 8), mid(e) - 8 - rand(0, 10), String(dmg), isWeak ? UIC.gold : '#fff', isWeak);
  if (isWeak) {
    e.known[type] = 'weak';
    if (!e.broken) {
      e.shield--;
      sfx('weak');
      if (e.shield <= 0) {
        e.shield = 0; e.broken = 1; e.brokenUntil = b.round + 1;
        b.breakFx = 1.2; b.flash = 0.6; b.shake = 6;
        sfx('break');
        breakShards(e);
        G.stats.breaks++;
        if (e.telegraph) { e.telegraph = false; e.fizzled = 1.6; pop(e.x, e.top - 18, 'BIG FLAP CANCELLED', '#9ad0ff'); }
      }
    } else sfx('hit');
  } else {
    if (!e.known[type]) e.known[type] = 'no';
    sfx('hit');
  }
  if (e.hp <= 0) { e.hp = 0; e.alive = false; e.dying = 1; sfx('die'); dissolve(e); }
}

async function doPartyAction(a, act) {
  const b = G.battle;
  const boost = act.boost || 0;
  if (boost) { b.bp[a.id] -= boost; b.boosted[a.id] = true; sfx('boost', 1 + boost * 0.3); burstBoost(a, boost); await wait(0.35); }
  a.defending = false;
  if (act.kind === 'defend') { a.defending = true; bmsg(`${a.name} braces for impact.`, 1); await wait(0.7); return; }
  if (act.kind === 'attack') {
    let t = act.target;
    bmsg(`${a.name} attacks with the ${a.weapon === 'broom' ? 'Broom of Office' : 'slingshot'}!`, 1);
    await stepForward(a);
    for (let i = 0; i < 1 + boost; i++) {
      if (!t.alive) { t = aliveEnemies()[0]; if (!t) break; }
      if (a.weapon === 'sling') sfx('sling');
      await hitEnemy(a, t, 1, 'atk', a.weapon, 1);
      await wait(0.24);
    }
    await wait(0.35);
    a.step = 0;
    return;
  }
  if (act.kind === 'skill') {
    const sk = act.skill, mul = BOOST_MUL[boost];
    a.sp -= sk.sp;
    bmsg(`${a.name} uses ${sk.name}!` + (boost ? ` (Boost ×${boost})` : ''), 1.1);
    await stepForward(a);
    if (sk.type === 'fire') sfx('fire');
    if (sk.type === 'sass') sfx('sass');
    if (sk.target === 'one') await hitEnemy(a, act.target, sk.power, sk.stat, sk.type, mul);
    else if (sk.target === 'all') { for (const e of aliveEnemies()) { await hitEnemy(a, e, sk.power, sk.stat, sk.type, mul); await wait(0.12); } }
    else if (sk.target === 'random3') {
      for (let i = 0; i < 3 + boost; i++) { const al = aliveEnemies(); if (!al.length) break; sfx('sling'); await hitEnemy(a, pick(al), sk.power, sk.stat, sk.type, 1); await wait(0.2); }
    } else if (sk.type === 'heal') {
      const t = act.target, amt = Math.round(sk.power * mul);
      t.hp = Math.min(t.maxHp, t.hp + amt);
      sfx('heal'); healFx(t); pop(t.bx, t.btop, '+' + amt, UIC.green, true);
      if (Math.random() < 0.5) bmsg(pick(['"You\'re doing great. Like a sandwich."', '"Believe in yourself! Or in snacks!"', '"Remember: bread is just a sandwich that hasn\'t happened yet."']), 1.8);
    } else if (sk.type === 'nap') {
      const amt = Math.round(sk.power * mul);
      a.hp = Math.min(a.maxHp, a.hp + amt);
      sfx('heal'); healFx(a); pop(a.bx, a.btop, '+' + amt, UIC.green, true);
      bmsg('Moss lies down dramatically. Sighs. Feels better.', 1.6);
    }
    await wait(0.6);
    a.step = 0;
    return;
  }
  if (act.kind === 'item') {
    const it = ITEMS[act.key];
    inventory[act.key]--;
    bmsg(`${a.name} uses a ${it.name}!`, 1);
    await stepForward(a);
    if (it.heal) { const t = act.target; t.hp = Math.min(t.maxHp, t.hp + it.heal); sfx('heal'); healFx(t); pop(t.bx, t.btop, '+' + it.heal, UIC.green, true); }
    if (it.sp) { const t = act.target; t.sp = Math.min(t.maxSp, t.sp + it.sp); sfx('heal'); healFx(t); pop(t.bx, t.btop, '+' + it.sp + ' SP', UIC.blue, true); }
    if (it.dmg) { sfx('fire'); for (const e of aliveEnemies()) { await hitEnemy({ atk: it.dmg / 2.3, mag: it.dmg / 2.3 }, e, 1, 'atk', it.type, 1); await wait(0.1); } }
    await wait(0.6);
    a.step = 0;
  }
}

async function enemyTurn(e) {
  const b = G.battle, d = e.def0;
  e.step = 1;
  if (e.kind === 'gerald') {
    if (!e.enraged && e.hp < e.maxHp * 0.5) {
      e.enraged = true;
      bmsg('Gerald is getting EMOTIONAL! He flaps faster!', 1.8);
      await wait(1.6);
    }
    if (e.telegraph) {
      e.telegraph = false;
      bmsg('DUST STORM! Gerald flaps with all his heart!', 1.2);
      sfx('whoosh');
      b.dust = 1.2;
      await wait(0.6);
      for (const p of aliveParty()) { enemyHit(e, p, 1.4); await wait(0.15); }
      await wait(0.7);
      e.step = 0;
      return;
    }
    if (Math.random() < (e.enraged ? 0.4 : 0.25)) {
      e.telegraph = true;
      bmsg('Gerald is winding up a really big flap! Break him before it lands!', 2);
      await wait(1.6);
      e.step = 0;
      return;
    }
  }
  const tot = d.moves.reduce((s, m) => s + m.w, 0);
  let r = Math.random() * tot, mv = d.moves[0];
  for (const m of d.moves) { r -= m.w; if (r <= 0) { mv = m; break; } }
  if (mv.heal && e.hp > e.maxHp * 0.8) mv = d.moves[0];
  const t = pick(aliveParty());
  if (mv.heal) {
    e.hp = Math.min(e.maxHp, e.hp + mv.heal);
    sfx('heal'); pop(e.x, e.top + 4, '+' + mv.heal, UIC.green, true);
    bmsg(mv.line.replace(/\{e\}/g, e.name).replace('{n}', mv.heal), 1.8);
    await wait(1.4);
  } else if (!mv.power) {
    bmsg(mv.line.replace(/\{e\}/g, e.name), 2);
    await wait(1.8);
  } else {
    bmsg(mv.line ? mv.line.replace(/\{e\}/g, e.name).replace(/\{t\}/g, t.name) : `${e.name} uses ${mv.name}!`, 1.4);
    await wait(0.5);
    enemyHit(e, t, mv.power);
    await wait(0.9);
  }
  e.step = 0;
  if (e.kind === 'gerald' && e.enraged && !e.extra && aliveParty().length && !e.broken && Math.random() < 0.55) { e.extra = true; await enemyTurn(e); e.extra = false; }
}
function enemyHit(e, p, power) {
  let dmg = Math.max(1, Math.round((e.atk * 2 * power - p.def) * rand(0.9, 1.1)));
  if (p.defending) dmg = Math.round(dmg * 0.5);
  p.hp = Math.max(0, p.hp - dmg);
  p.hurt = 0.3;
  G.battle.shake = 3; sfx('enemyAtk');
  pop(p.bx, p.btop - 2, String(dmg), UIC.red, true);
  for (let i = 0; i < 10; i++) G.battle.fx.push({ kind: 'spark', x: p.bx, y: (p.by + p.btop) / 2, vx: rand(-60, 60), vy: rand(-70, 10), t: 0, life: 0.4, col: [255, 120, 120] });
  if (p.hp <= 0) pop(p.bx, p.btop - 14, 'K.O.', '#ff8a8a');
}

async function victory() {
  const b = G.battle;
  audio.play('victory');
  const exp = b.enemies.reduce((s, e) => s + e.def0.exp, 0);
  bmsg('You won!', 2);
  G.stats.wins++;
  await wait(1.2);
  const lines = [];
  for (const p of b.active) {
    if (p.hp <= 0) p.hp = 1;
    p.exp += exp;
    while (p.exp >= 20 + p.lv * 6) {
      p.exp -= 20 + p.lv * 6; p.lv++;
      p.maxHp += 12; p.maxSp += 4; p.atk += 2; p.mag += 2; p.def += 1; p.spd += 1;
      p.hp = Math.min(p.maxHp, p.hp + 12);
      const flav = p.id === 'pip'
        ? ['Pip feels slightly more like an adult.', 'Pip\'s broom technique is now "acceptable".', 'Pip can now name three types of cheese.', 'Pip\'s lantern arm is getting strong.']
        : ['Moss is unimpressed.', 'Moss\'s sighs are now 20% more devastating.', 'Moss has upgraded from "moody" to "brooding".', 'Moss would like it noted that this changes nothing.'];
      p.flav = (p.flav ?? -1) + 1;
      lines.push(`${p.name} reached level ${p.lv}! ${flav[p.flav % flav.length]}`);
    }
  }
  await narrate(`Gained ${exp} EXP.`);
  for (const l of lines) { sfx('levelup'); await narrate(l); }
  if (b.opts.drop) { inventory[b.opts.drop] = (inventory[b.opts.drop] || 0) + 1; sfx('item'); await narrate(`Found a ${ITEMS[b.opts.drop].name}!`); }
  return 'win';
}

// ---------- fx ----------
function spawnHitFx(e, type, weak) {
  const fx = G.battle.fx, my = mid(e);
  const col = type === 'fire' ? [255, 150, 60] : type === 'sass' ? [220, 140, 255] : type === 'sling' ? [200, 220, 255] : [255, 230, 140];
  for (let i = 0; i < (weak ? 22 : 12); i++) fx.push({ kind: 'spark', x: e.x + rand(-6, 6), y: my + rand(-6, 6), vx: rand(-100, 100), vy: rand(-110, 30), t: 0, life: rand(0.3, 0.6), col });
  fx.push({ kind: 'slash', x: e.x, y: my, t: 0, life: 0.25, type, rot: rand(-0.6, 0.6), r: Math.max(10, e.w * 0.35) });
  if (type === 'fire') for (let i = 0; i < 16; i++) fx.push({ kind: 'spark', x: e.x + rand(-10, 10), y: e.y - 6, vx: rand(-20, 20), vy: rand(-90, -40), t: 0, life: rand(0.4, 0.8), col: pick([[255, 200, 80], [255, 120, 40]]) });
}
function breakShards(e) { for (let i = 0; i < 30; i++) G.battle.fx.push({ kind: 'shard', x: e.x, y: mid(e), vx: rand(-170, 170), vy: rand(-190, 40), t: 0, life: rand(0.6, 1.1), rot: rand(0, TAU), vr: rand(-12, 12), s: rand(2, 5) }); }
function burstBoost(a, n) { for (let i = 0; i < 10 + n * 8; i++) G.battle.fx.push({ kind: 'spark', x: a.bx + rand(-8, 8), y: a.by, vx: rand(-20, 20), vy: rand(-90, -40), t: 0, life: rand(0.5, 0.9), col: n >= 3 ? [255, 120, 220] : n === 2 ? [255, 200, 80] : [120, 220, 255] }); }
function healFx(p) { for (let i = 0; i < 16; i++) G.battle.fx.push({ kind: 'spark', x: p.bx + rand(-10, 10), y: p.by + rand(-4, 4), vx: rand(-10, 10), vy: rand(-60, -30), t: 0, life: rand(0.6, 1), col: [140, 255, 160] }); }
// the monster's own pixels drift up and away while the sprite dithers out
function dissolve(e) {
  const A = e.actor;
  const c = frameCanvas(A.frameKey), f = frame(A.frameKey);
  if (!f.pixels) f.pixels = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const data = f.pixels;
  const step = Math.max(2, Math.round(c.width / 40));
  const sx = e.w / c.width, sy = (e.y - e.top) / c.height;
  for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) {
    const i = (y * c.width + x) * 4;
    if (data[i + 3] && Math.random() < 0.55) G.battle.fx.push({ kind: 'pix', x: e.x - e.w / 2 + x * sx, y: e.top + y * sy, vx: rand(-20, 20), vy: rand(-50, -10), t: -Math.random() * 0.4 - (c.height - y) / c.height * 0.4, life: 1, col: [data[i], data[i + 1], data[i + 2]], s: Math.max(1.5, step * sx) });
  }
  void f;
}

// ---------- per-frame ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function updateBattle(dt) {
  const b = G.battle;
  b.t += dt;
  b.intro = Math.max(0, b.intro - dt * 1.4);
  b.shake = Math.max(0, b.shake - dt * 20);
  b.flash = Math.max(0, b.flash - dt * 2);
  b.breakFx = Math.max(0, b.breakFx - dt);
  b.msgT -= dt;
  if (b.dust) b.dust = Math.max(0, b.dust - dt);
  camState.shake = b.shake;
  for (const e of b.enemies) {
    e.flash = Math.max(0, e.flash - dt); e.shake = Math.max(0, e.shake - dt);
    const A = e.actor;
    if (!A) continue;
    // sprite animation, bob, break tilt, hit flash / telegraph glow, dissolve
    const keyBase = e.kind === 'shrub' ? 'shrub_' : e.kind === 'moth' ? 'mothling_' : 'gerald_';
    const n = e.kind === 'shrub' ? 2 : 3;
    const fps = e.kind === 'shrub' ? 2.5 : e.kind === 'gerald' ? (e.enraged ? 12 : 6) : 9;
    A.setFrame(keyBase + (Math.floor(b.t * fps + e.ph) % n), false);
    A.bob = e.kind !== 'shrub' ? Math.sin(b.t * 2 + e.ph) * 0.08 : 0;
    A.ox = (e.shake > 0 ? rand(-0.08, 0.08) : 0) + (e.step ? 0.6 : 0);
    A.tilt = e.broken ? -0.14 : 0;
    const fl = A.U.uFlash.value;
    if (e.flash > 0) fl.set(1, 1, 1, Math.min(1, e.flash / 0.15) * 0.9);
    else if (e.telegraph) fl.set(1, 0.45, 0.25, 0.25 + 0.2 * Math.sin(b.t * 12));
    else if (e.broken) fl.set(0.55, 0.6, 0.85, 0.12);
    else fl.w = 0;
    if (!e.alive) { e.dying = Math.max(0, e.dying - dt * 1.4); A.U.uFade.value = 1 - e.dying; if (e.dying <= 0) A.visible = false; }
    A.sync();
    // screen anchors (virtual px)
    A.anchor(_a, 0); A.anchor(_b, 1);
    const pa = project(_a), pb = project(_b);
    e.x = pa[0]; e.y = pa[1]; e.top = pb[1];
    e.w = (pa[1] - pb[1]) * A.w / A.hgt;
  }
  for (const p of b.active) {
    p.hurt = Math.max(0, (p.hurt || 0) - dt);
    const A = p.actor;
    const ko = p.hp <= 0;
    A.dir = 'left';
    A.moving = b.actor === p && !ko;
    A.ox = (p.step ? -0.7 : 0) + (p.hurt > 0 ? rand(-0.07, 0.07) : 0);
    A.tilt = ko ? 1.45 : 0;
    A.U.uFlash.value.set(0.3, 0.2, 0.5, ko ? 0.35 : (p.hurt > 0 ? 0.25 : 0));
    if (p.hurt > 0 && !ko) A.U.uFlash.value.set(1, 0.4, 0.4, 0.35);
    A.update(dt, 0.8);
    A.anchor(_a, 0); A.anchor(_b, 1);
    const pa = project(_a), pb = project(_b);
    p.bx = pa[0]; p.by = pa[1]; p.btop = pb[1];
  }
  for (let i = b.fx.length - 1; i >= 0; i--) {
    const f = b.fx[i];
    f.t += dt;
    if (f.t < 0) continue;
    if (f.t > f.life) { b.fx.splice(i, 1); continue; }
    if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.kind === 'shard' ? 300 : f.kind === 'pix' ? -40 : 120) * dt; }
    if (f.vr) f.rot += f.vr * dt;
  }
  for (let i = b.pops.length - 1; i >= 0; i--) { b.pops[i].t += dt; if (b.pops[i].t > 1.1) b.pops.splice(i, 1); }
  updateBattleInput();
}

// ---------- overlay drawing ----------
function drawShield(x, y, e) {
  const u = V.S;
  D.save(); D.translate(x, y);
  D.fillStyle = e.broken ? '#6a5a7a' : '#7ac8ff';
  D.beginPath(); D.moveTo(0, 0); D.lineTo(9 * u, 0); D.lineTo(9 * u, 5 * u); D.quadraticCurveTo(4.5 * u, 11 * u, 4.5 * u, 11 * u); D.quadraticCurveTo(0, 7 * u, 0, 5 * u); D.closePath(); D.fill();
  D.strokeStyle = '#fff'; D.lineWidth = u * 0.5; D.stroke();
  D.restore();
  text(String(e.shield), x + 4.5 * u, y + 1.5 * u, 6.5 * u, e.broken ? '#ffd060' : '#10203a', 'center', 700, false);
}
function backButton(x, y, fn) {
  const u = V.S;
  panel(x, y, 30 * u, 16 * u, { r: 4 * u, noStuds: true });
  text('Back', x + 15 * u, y + 4 * u, 6.5 * u, UIC.dim, 'center', 700);
  hits.push({ x, y, w: 30 * u, h: 16 * u, fn });
}

export function drawBattle() {
  const b = G.battle, u = V.S, W = V.W, H = V.H;
  const sh = b.shake > 0 ? rand(-b.shake, b.shake) * u * 0.5 : 0;
  // legibility: soft darkening top and bottom, warm vignette
  const g = D.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(8,6,22,0.45)'); g.addColorStop(0.25, 'rgba(8,6,22,0)'); g.addColorStop(0.72, 'rgba(8,6,22,0)'); g.addColorStop(1, 'rgba(8,6,22,0.55)');
  D.fillStyle = g; D.fillRect(0, 0, W, H);
  D.save(); D.translate(sh, 0);
  // broken: dizzy stars; telegraph / target markers
  for (const e of b.enemies) {
    if (!e.alive) continue;
    if (e.broken) for (let i = 0; i < 3; i++) {
      const a = b.t * 4 + i * TAU / 3;
      D.fillStyle = '#ffe070'; D.fillRect((e.x + Math.cos(a) * e.w * 0.3) * u, (e.top - 2 + Math.sin(a) * 3) * u, 2 * u, 2 * u);
    }
    if (b.menu && b.menu.stage === 'target' && !b.menu.allyT && targetList()[b.menu.tsel] === e) {
      const ay = (e.top - 10 + Math.sin(b.t * 8) * 2) * u, ax = e.x * u;
      D.fillStyle = '#ffe070'; D.beginPath(); D.moveTo(ax - 5 * u, ay); D.lineTo(ax + 5 * u, ay); D.lineTo(ax, ay + 6 * u); D.fill();
    }
  }
  for (const p of b.active) {
    if (b.actor === p) {
      const ay = (p.btop - 8 + Math.sin(b.t * 6) * 1.5) * u, ax = p.bx * u;
      D.fillStyle = '#7ad8ff'; D.beginPath(); D.moveTo(ax - 4 * u, ay); D.lineTo(ax + 4 * u, ay); D.lineTo(ax, ay + 5 * u); D.fill();
      if (b.boost > 0) {
        D.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6 + b.boost * 5; i++) {
          const a = b.t * 3 + i * 1.7, r2 = 9 + Math.sin(b.t * 5 + i) * 2;
          D.fillStyle = b.boost >= 3 ? '#ff8ae0' : b.boost === 2 ? '#ffd060' : '#80e0ff';
          D.fillRect((p.bx + Math.cos(a) * r2) * u, ((p.by + p.btop) / 2 + Math.sin(a) * r2 * 1.3 - ((b.t * 20 + i * 5) % 14)) * u, 1.5 * u, 1.5 * u);
        }
        D.globalCompositeOperation = 'source-over';
      }
    }
    if (b.menu && b.menu.stage === 'target' && b.menu.allyT && targetList()[b.menu.tsel] === p) {
      const ay = (p.btop - 8 + Math.sin(b.t * 8) * 2) * u, ax = p.bx * u;
      D.fillStyle = '#7aeb8a'; D.beginPath(); D.moveTo(ax - 4 * u, ay); D.lineTo(ax + 4 * u, ay); D.lineTo(ax, ay + 5 * u); D.fill();
    }
  }
  // fx
  D.globalCompositeOperation = 'lighter';
  for (const f of b.fx) {
    if (f.t < 0) continue;
    const k = f.t / f.life;
    if (f.kind === 'spark') { D.fillStyle = css(f.col, 1 - k); D.fillRect(f.x * u, f.y * u, 1.4 * u, 1.4 * u); }
    else if (f.kind === 'shard') {
      D.save(); D.translate(f.x * u, f.y * u); D.rotate(f.rot); D.fillStyle = `rgba(200,240,255,${1 - k})`; D.beginPath(); D.moveTo(0, -f.s * u); D.lineTo(f.s * 0.6 * u, f.s * u); D.lineTo(-f.s * 0.6 * u, f.s * 0.4 * u); D.fill(); D.restore();
    } else if (f.kind === 'slash') {
      const col = f.type === 'fire' ? '#ffb050' : f.type === 'sass' ? '#e0a0ff' : f.type === 'sling' ? '#d0e8ff' : '#fff2b0';
      D.save(); D.translate(f.x * u, f.y * u); D.rotate(f.rot); D.strokeStyle = col; D.globalAlpha = 1 - k; D.lineWidth = 2 * u;
      D.beginPath(); D.arc(0, 0, (f.r + k * 8) * u, -1.2, 1.2 - k); D.stroke(); D.restore(); D.globalAlpha = 1;
    }
  }
  D.globalCompositeOperation = 'source-over';
  for (const f of b.fx) {
    if (f.kind !== 'pix' || f.t < 0) continue;
    const k = f.t / f.life;
    D.fillStyle = css(f.col, 1 - k); D.fillRect(f.x * u, f.y * u, f.s * u, f.s * u);
  }
  if (b.dust > 0) {
    D.fillStyle = `rgba(230,210,170,${Math.min(0.5, b.dust * 0.5)})`;
    for (let i = 0; i < 120; i++) D.fillRect(((i * 53 + b.t * 260) % V.VW) * u, ((i * 31 + Math.sin(b.t * 3 + i) * 10) % V.VH) * u, 2 * u, 1 * u);
  }
  D.restore();
  if (b.flash > 0) { D.fillStyle = `rgba(255,255,255,${b.flash})`; D.fillRect(0, 0, W, H); }
  drawBattleUI();
  drawBattleTop();
  // intro: shattered-glass swirl wipe
  if (b.intro > 0) {
    const k = b.intro;
    D.fillStyle = '#05040c';
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU + (1 - k) * 2, a1 = a0 + TAU / n * k;
      D.beginPath(); D.moveTo(W / 2, H / 2); D.arc(W / 2, H / 2, Math.hypot(W, H), a0, a1); D.closePath(); D.fill();
    }
  }
}

function drawBattleUI() {
  const b = G.battle, u = V.S, W = V.W, H = V.H, DPR = V.DPR;
  // chrome (turn order, party, commands) steps aside for dialogue and the closing fade
  const chrome = !G.dlg && !b.over && G.fade.a < 0.05;
  for (const e of b.enemies) {
    if (!e.alive || b.over) continue;
    const big = e.kind === 'gerald';
    // with two monsters the back one's info sits above its head, the front one's under its feet
    const up = b.enemies.length > 1 && b.enemies.indexOf(e) % 2 === 0;
    const minY = 26 + safe.t * DPR / u;
    const bw = (big ? 56 : 36) * u;
    const lx = clamp(e.x * u, bw / 2 + 16 * u, W - bw / 2 - 8 * u);
    const y = (up || big ? Math.max(minY, e.top - 24) : Math.min(e.y + 3, V.VH - 30)) * u;
    text(e.name, lx, y, 5.5 * u, UIC.text, 'center', 700);
    bar(lx - bw / 2, y + 7.5 * u, bw, 2 * u, e.hp / e.maxHp, e.broken ? '#ffb050' : '#ff7a8a');
    drawShield(lx - bw / 2 - 11 * u, y + 10.5 * u, e);
    TYPES.forEach((ty, i) => {
      const ix = lx - bw / 2 + 1.5 * u + i * 9 * u, iy = y + 11.5 * u;
      const k = e.known[ty];
      D.fillStyle = 'rgba(10,6,24,0.7)'; rr(ix - 0.8 * u, iy - 0.8 * u, 9 * u, 9 * u, 1.5 * u); D.fill();
      D.imageSmoothingEnabled = false;
      if (k) {
        D.globalAlpha = k === 'no' ? 0.35 : 1;
        D.drawImage(ICONS[ty], ix, iy, 7.4 * u, 7.4 * u);
        D.globalAlpha = 1;
        if (k === 'absorb') { D.strokeStyle = '#ff6a3a'; D.lineWidth = u; D.beginPath(); D.moveTo(ix, iy); D.lineTo(ix + 7.4 * u, iy + 7.4 * u); D.stroke(); }
      } else D.drawImage(ICONS.q, ix, iy, 7.4 * u, 7.4 * u);
    });
    if (e.broken) text('BREAK', e.x * u, (e.top - 8) * u, 7 * u, '#ffd060', 'center', 700);
    if (e.telegraph) text('WINDING UP!', e.x * u, (e.top - 8) * u, 6.5 * u, '#ff9a6a', 'center', 700);
  }
  if (!chrome) return;
  // turn order
  const order = b.order.filter(a => a.hp > 0 && a.alive !== false);
  let ox = 8 * u + safe.l * DPR;
  const oy = 5 * u + safe.t * DPR;
  text('TURN', ox, oy + 1.2 * u, 4.5 * u, UIC.dim, 'left', 700);
  ox += 16 * u;
  order.forEach(a => {
    const isP = party.includes(a), cur = b.order[b.orderIdx] === a;
    const w = 17 * u;
    D.fillStyle = cur ? 'rgba(255,215,90,0.9)' : isP ? 'rgba(80,140,230,0.7)' : 'rgba(200,70,90,0.7)';
    rr(ox, oy, w, 7.5 * u, 2.5 * u); D.fill();
    text(isP ? a.name.slice(0, 4) : a.name.replace("Lil' ", '').slice(0, 4), ox + w / 2, oy + 1.2 * u, 4.6 * u, cur ? '#2a1a10' : '#fff', 'center', 700, false);
    ox += w + 2 * u;
  });
  // party panel: one compact row per member (name, HP, SP, Boost pips)
  const rowH = 14 * u, pw = 128 * u, ph = b.active.length * rowH + 5 * u, px = W - pw - 6 * u - safe.r * DPR, py = H - ph - 6 * u - safe.b * DPR;
  panel(px, py, pw, ph, { noStuds: true, r: 2.5 * u });
  b.active.forEach((p, i) => {
    const y = py + 3 * u + i * rowH, cur = b.actor === p;
    if (cur) { D.fillStyle = 'rgba(122,216,255,0.14)'; rr(px + 2 * u, y - 0.5 * u, pw - 4 * u, rowH - 0.5 * u, 2 * u); D.fill(); }
    text(p.name, px + 6 * u, y + 0.8 * u, 6.2 * u, p.hp <= 0 ? UIC.red : cur ? UIC.blue : UIC.text, 'left', 700);
    for (let k = 0; k < 5; k++) {
      const filled = k < b.bp[p.id], pending = cur && k >= b.bp[p.id] - b.boost && k < b.bp[p.id];
      D.fillStyle = pending ? (Math.floor(G.t * 8) % 2 ? '#ffffff' : '#ff8ae0') : filled ? '#ffd060' : 'rgba(255,255,255,0.15)';
      D.beginPath(); D.arc(px + 7.5 * u + k * 4.4 * u, y + 10 * u, 1.5 * u, 0, TAU); D.fill();
    }
    const hx = px + 32 * u;
    text('HP', hx, y + 1.3 * u, 4.3 * u, UIC.dim, 'left', 700, false);
    text(`${p.hp}`, hx + 44 * u, y + 0.6 * u, 5.6 * u, p.hp < p.maxHp * 0.3 ? '#ff9a7a' : UIC.text, 'right', 700, false);
    bar(hx, y + 8 * u, 44 * u, 2.4 * u, p.hp / p.maxHp, p.hp < p.maxHp * 0.3 ? '#ff8a6a' : '#7aeb8a');
    const sx = px + 84 * u;
    text('SP', sx, y + 1.3 * u, 4.3 * u, UIC.dim, 'left', 700, false);
    text(`${p.sp}`, sx + 38 * u, y + 0.6 * u, 5.6 * u, p.sp < 6 ? '#ff9a7a' : UIC.text, 'right', 700, false);
    bar(sx, y + 8 * u, 38 * u, 2.4 * u, p.sp / p.maxSp, '#7ac8ff');
  });
  // command menus
  const m = b.menu;
  if (m) {
    const a = m.actor;
    const cw = 62 * u, cx = 6 * u + safe.l * DPR, rowH = 10 * u;
    if (m.stage === 'cmd' || m.stage === 'target') {
      const cmds = battleCommands(a);
      const ch = cmds.length * rowH + 6 * u, cy = H - ch - 6 * u - safe.b * DPR;
      panel(cx, cy, cw, ch, { noStuds: true, r: 2.5 * u });
      cmds.forEach((c, i) => {
        const y = cy + 3 * u + i * rowH, sel = i === m.sel && m.stage === 'cmd';
        if (sel) { D.fillStyle = 'rgba(255,215,90,0.18)'; rr(cx + 2 * u, y, cw - 4 * u, rowH - 0.5 * u, 2 * u); D.fill(); }
        text(c.label, cx + 7 * u, y + 2 * u, 6.2 * u, sel ? UIC.gold : UIC.text, 'left', 700);
        if (c.sub) text(c.sub, cx + cw - 5 * u, y + 2.8 * u, 4.6 * u, UIC.dim, 'right', 600, false);
        hits.push({ x: cx, y, w: cw, h: rowH, fn: () => { if (G.battle && G.battle.menu === m && !G.dlg) { m.stage = 'cmd'; m.allyT = false; pickCmd(i); } } });
      });
      if (m.stage === 'target') {
        text(m.allyT ? 'Choose an ally' : 'Choose a target', W / 2, 20 * u + safe.t * DPR, 6.5 * u, UIC.gold, 'center', 700);
        targetList().forEach((tg, i) => {
          const tx = (m.allyT ? tg.bx : tg.x) * u, top = (m.allyT ? tg.btop : tg.top) * u, bot = (m.allyT ? tg.by : tg.y) * u;
          const w = Math.max(30 * u, (m.allyT ? 24 : tg.w) * u);
          hits.push({ x: tx - w / 2, y: top, w, h: bot - top + 10 * u, fn: () => { if (G.battle && G.battle.menu === m) { m.tsel = i; pickTarget(i); } } });
        });
        backButton(cx + cw + 4 * u, H - 22 * u - safe.b * DPR, () => { if (G.battle.menu === m) { m.stage = m.prev || 'cmd'; m.allyT = false; sfx('back'); } });
      }
    } else {
      const list = m.stage === 'skill' ? a.skills : itemList().map(k => ({ name: ITEMS[k].name, key: k, desc: ITEMS[k].desc, type: ITEMS[k].type }));
      const lw = 132 * u, lh = list.length * rowH + 16 * u, ly = H - lh - 6 * u - safe.b * DPR;
      panel(cx, ly, lw, lh, { noStuds: true, r: 2.5 * u });
      list.forEach((s, i) => {
        const y = ly + 3 * u + i * rowH, sel = i === m.sel2;
        const can = m.stage !== 'skill' || a.sp >= s.sp;
        if (sel) { D.fillStyle = 'rgba(255,215,90,0.18)'; rr(cx + 2 * u, y, lw - 4 * u, rowH - 0.5 * u, 2 * u); D.fill(); }
        if (s.type && ICONS[s.type]) { D.imageSmoothingEnabled = false; D.drawImage(ICONS[s.type], cx + 5 * u, y + 1.5 * u, 7 * u, 7 * u); }
        text(s.name, cx + 15 * u, y + 2 * u, 6.2 * u, !can ? '#7a7090' : sel ? UIC.gold : UIC.text, 'left', 700);
        text(m.stage === 'skill' ? `${s.sp} SP` : `×${inventory[s.key]}`, cx + lw - 6 * u, y + 2.6 * u, 5 * u, UIC.blue, 'right', 600, false);
        hits.push({ x: cx, y, w: lw, h: rowH, fn: () => { if (G.battle.menu === m) pickSub(i); } });
      });
      const sel = list[m.sel2];
      if (sel) text(sel.desc + (m.stage === 'skill' && b.boost ? `  Boost ×${BOOST_MUL[b.boost]}` : ''), cx + 6 * u, ly + lh - 11 * u, 4.8 * u, UIC.dim);
      backButton(cx + lw + 4 * u, H - 22 * u - safe.b * DPR, () => { if (G.battle.menu === m) { m.stage = 'cmd'; sfx('back'); } });
    }
    // boost button: docked to the party panel, level with the acting character's row
    const ai = Math.max(0, b.active.indexOf(a));
    const br = 10 * u, bx = px - br - 4 * u, by = py + 3 * u + ai * rowH + rowH / 2;
    const can = b.bp[a.id] > 0;
    const pulse = b.boost ? 1 + Math.sin(G.t * 10) * 0.05 : 1;
    const gg = D.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br * pulse);
    const cols = b.boost >= 3 ? ['#ffc0f0', '#c040a0'] : b.boost === 2 ? ['#ffe8a0', '#d08020'] : b.boost === 1 ? ['#c0f0ff', '#3080d0'] : ['#8a80a8', '#40385a'];
    gg.addColorStop(0, cols[0]); gg.addColorStop(1, cols[1]);
    D.globalAlpha = can ? 1 : 0.5;
    D.fillStyle = gg; D.beginPath(); D.arc(bx, by, br * pulse, 0, TAU); D.fill();
    D.strokeStyle = 'rgba(255,255,255,0.7)'; D.lineWidth = u * 0.5; D.stroke();
    text('BOOST', bx, by - 4.6 * u, 4.2 * u, '#fff', 'center', 700);
    text(b.boost ? '×' + (b.boost + 1) : '—', bx, by + 0.2 * u, 5.6 * u, '#fff', 'center', 700);
    if (!touch.ui) text('E / Q', bx, by + br + 1.5 * u, 4.2 * u, UIC.dim, 'center', 600);
    D.globalAlpha = 1;
    hits.push({ x: bx - br, y: by - br, w: br * 2, h: br * 2, fn: () => { if (G.battle.menu === m) boostChange(1); } });
  }
}
function drawBattleTop() {
  const b = G.battle, u = V.S, W = V.W, H = V.H, DPR = V.DPR;
  if (b.msgT > 0 && b.msg && !b.over && !G.dlg) {
    D.font = font(6.5 * u, 600);
    const w = Math.min(W - 20 * u, D.measureText(b.msg).width + 20 * u);
    D.globalAlpha = Math.min(1, b.msgT * 4);
    panel((W - w) / 2, 16 * u + safe.t * DPR, w, 12.5 * u, { r: 6 * u, noStuds: true });
    text(b.msg, W / 2, 19 * u + safe.t * DPR, 6.5 * u, UIC.text, 'center', 600);
    D.globalAlpha = 1;
  }
  for (const p of b.pops) {
    const k = p.t / 1.1, rise = easeOutBack(Math.min(1, p.t * 4)) * 10;
    D.globalAlpha = Math.min(1, (1 - k) * 3);
    text(p.str, p.x * u, (p.y - rise) * u, (p.big ? 9.5 : 6.5) * u, p.col, 'center', 700);
    D.globalAlpha = 1;
  }
  if (b.breakFx > 0) {
    const k = 1 - b.breakFx / 1.2;
    const sc = k < 0.15 ? easeOutBack(k / 0.15) : 1;
    D.save();
    D.globalAlpha = Math.min(1, b.breakFx * 2);
    D.translate(W / 2, H * 0.4); D.rotate(-0.08); D.scale(sc, sc);
    D.font = font(28 * u, 700); D.textAlign = 'center'; D.textBaseline = 'middle';
    D.lineWidth = 3 * u; D.strokeStyle = '#2a0a20'; D.strokeText('BREAK!', 0, 0);
    const g = D.createLinearGradient(0, -16 * u, 0, 16 * u); g.addColorStop(0, '#fff8c0'); g.addColorStop(0.5, '#ffd040'); g.addColorStop(1, '#ff6a3a');
    D.fillStyle = g; D.fillText('BREAK!', 0, 0);
    D.restore();
  }
}
