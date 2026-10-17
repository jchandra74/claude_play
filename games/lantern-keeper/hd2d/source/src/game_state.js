// Shared mutable game state for the playable demo (ported from the original's globals):
// mode, story flags, party + inventory, dialogue / choice / toast queues, fades, timers.
import { sfx } from './game_audio.js';

export const G = {
  mode: 'loading',            // loading | title | field | battle | ending
  area: 'town',               // town | forest
  t: 0,
  flags: {},
  stats: { wins: 0, breaks: 0 },
  dlg: null, choiceBox: null, menuOpen: null, scriptBusy: false, toasts: [],
  fade: { a: 1, target: 0, speed: 1.5, col: '#05040c', res: null },
  cine: 0, cineTarget: 0,
  battle: null,
  lanternK: 0,                // 0 = Great Lantern out, 1 = relit
  shake: 0, flash: 0,
  titleT: 0, endingT: 0,
  hint: '',
  objective: '',              // current goal, shown in the field HUD and the pause menu
  lastDlg: null,              // the line just spoken: stays on screen under a choice box
};

export const party = [
  { id: 'pip', name: 'Pip', lv: 3, exp: 0, hp: 120, maxHp: 120, sp: 40, maxSp: 40, atk: 14, mag: 15, def: 8, spd: 10, weapon: 'broom', joined: true,
    skills: [
      { name: 'Flicker', type: 'fire', sp: 6, power: 1.7, stat: 'mag', target: 'one', desc: 'A puff of lantern fire.' },
      { name: 'Big Sweep', type: 'broom', sp: 8, power: 1.0, stat: 'atk', target: 'all', desc: 'Sweeps every foe.' },
      { name: 'Pep Talk', type: 'heal', sp: 6, power: 50, target: 'ally', desc: 'Heals an ally. Mostly about sandwiches.' },
    ] },
  { id: 'moss', name: 'Moss', lv: 3, exp: 0, hp: 96, maxHp: 96, sp: 48, maxSp: 48, atk: 12, mag: 17, def: 6, spd: 13, weapon: 'sling', joined: false,
    skills: [
      { name: 'Withering Remark', type: 'sass', sp: 6, power: 1.6, stat: 'mag', target: 'one', desc: 'Emotional damage.' },
      { name: 'Pebble Storm', type: 'sling', sp: 8, power: 0.75, stat: 'atk', target: 'random3', desc: 'Three pebbles, random foes.' },
      { name: 'Dramatic Nap', type: 'nap', sp: 4, power: 45, target: 'self', desc: 'Lie down. Heal. Sigh.' },
    ] },
];
export const ITEMS = {
  cookie: { name: 'Cookie', desc: 'Heals 60 HP. Still warm, somehow.', target: 'ally', heal: 60 },
  tea: { name: 'Lukewarm Tea', desc: 'Restores 25 SP. Disappointing.', target: 'ally', sp: 25 },
  popper: { name: 'Party Popper', desc: 'Fire damage to all foes.', target: 'all', dmg: 40, type: 'fire' },
};
export const inventory = { cookie: 0, tea: 1, popper: 1 };

export function resetParty() {
  Object.assign(party[0], { lv: 3, exp: 0, hp: 120, maxHp: 120, sp: 40, maxSp: 40, atk: 14, mag: 15, def: 8, spd: 10 });
  Object.assign(party[1], { lv: 3, exp: 0, hp: 96, maxHp: 96, sp: 48, maxSp: 48, atk: 12, mag: 17, def: 6, spd: 13, joined: false });
  Object.assign(inventory, { cookie: 0, tea: 1, popper: 1 });
  for (const k in G.flags) delete G.flags[k];
  G.stats.wins = 0; G.stats.breaks = 0; G.objective = ''; G.lastDlg = null;
}

// ---------- timers & script helpers ----------
const timers = [];
export const wait = s => new Promise(res => timers.push({ t: s, res }));
export function updateTimers(dt) {
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const r = timers[i].res; timers.splice(i, 1); r(); } }
}
export function clearTimers() { timers.length = 0; }

export function blocking() { return !!(G.dlg || G.choiceBox || G.menuOpen || G.scriptBusy); }

export function say(name, text) {
  return new Promise(res => { G.dlg = { name, text, shown: 0, lines: null, res, t: 0 }; G.lastDlg = { name, text, t: G.t }; });
}
export const narrate = s => say(null, s);
export function choose(opts, prompt) {
  const q = G.lastDlg && G.t - G.lastDlg.t < 60 ? G.lastDlg : null;
  return new Promise(res => { G.choiceBox = { opts, sel: 0, res, prompt, t: 0, q }; sfx('move'); });
}
export function toast(str, col = '#ffd75a') { G.toasts.push({ str, t: 0, col }); }
export function fadeTo(a, dur = 0.6, col = '#05040c') {
  return new Promise(res => { const f = G.fade; f.target = a; f.speed = 1 / dur; f.col = col; if (f.a === a) res(); else f.res = res; });
}
export function runScript(fn) {
  if (G.scriptBusy) return;
  G.scriptBusy = true;
  Promise.resolve().then(fn).catch(e => { console.error(e); window.__lkError = String(e && e.stack || e); }).finally(() => { G.scriptBusy = false; });
}
