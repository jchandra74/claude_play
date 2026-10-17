import { open, sleep, shot, lk } from './playtest.mjs';
import { walkTo, face, press, talkThrough, fight, talkTo, hold } from './drive.mjs';
const { browser, page, logs } = await open('dtmax=0.3' + (process.env.NOPOST ? '&nopost' : ''), { width: 640, height: 300 });
const say = (l) => l.forEach(x => console.log('   ', x));
await sleep(2500); await shot(page, 'p01_title');
await press(page, 'z'); await sleep(1500);
say(await talkThrough(page, [], { onLine: async (s, n) => { if (n === 5) await shot(page, 'p02_intro_dialogue'); } }));
console.log('after intro', JSON.stringify(await lk(page)));
await shot(page, 'p03_after_intro');
// Odo again
say(await talkTo(page, 'odo', -9.85, 0.1, 'left'));
// to the Mayor
await walkTo(page, -1.0, 2.9); await shot(page, 'p04_walk_plaza_dark');
say(await talkTo(page, 'mayor', -1.9, 2.75, 'up', [], { onLine: async (s, n) => { if (n === 2) await shot(page, 'p05_mayor_dialogue'); } }));
// baker
say(await talkTo(page, 'baker', 7.6, -3.55, 'up'));
// Zuzu
say(await talkTo(page, 'zuzu', 4.45, 2.4, 'right'));
// Moss
say(await talkTo(page, 'moss', -4.6, -2.45, 'left'));
console.log(JSON.stringify(await lk(page)));
// Glen
say(await talkTo(page, 'glen', -5.3, 4.2, 'up'));
await shot(page, 'p06_party_walk');
// Barnaby at the east gate
say(await talkTo(page, 'barnaby', 18.9, -0.95, 'up'));
await sleep(1200); await shot(page, 'p07_gate_open');
console.log('gate', await page.evaluate(() => LK.gateOpen));
// through the gate
await walkTo(page, 21.3, -0.1, { allowArea: true });
for (let i = 0; i < 10 && (await lk(page)).area !== 'forest'; i++) await hold(page, ['ArrowRight'], 400);
await sleep(1500); say(await talkThrough(page));
console.log('forest', JSON.stringify((await lk(page)).player));
await shot(page, 'p08_forest');
// walk east along the path into the monsters
for (let k = 0; k < 4; k++) {
  for (let i = 0; i < 60; i++) {
    const s = await lk(page);
    if (s.mode === 'battle') break;
    if (s.dlg || s.busy) { await talkThrough(page, [0, 0]); continue; }
    if (s.player.lx > 33.5) break;
    await hold(page, ['ArrowRight'], 450);
    const p = (await lk(page)).player; const pz = await page.evaluate(lx => 0.7 * Math.sin(lx * 0.16) + 0.35 * Math.sin(lx * 0.41 + 1.3), p.lx);
    if (Math.abs(p.z - pz) > 0.5) { await hold(page, [p.z > pz ? 'ArrowUp' : 'ArrowDown'], 150); }
  }
  const s = await lk(page);
  if (s.mode === 'battle') {
    console.log('BATTLE', JSON.stringify(s.battle.enemies.map(e => e.name)));
    await sleep(1500);
    say(await fight(page, { onMenu: async () => { await shot(page, `p09_battle_${k}`); } }));
    await sleep(1500); say(await talkThrough(page));
    console.log('after battle', JSON.stringify((await lk(page)).player), JSON.stringify(await page.evaluate(() => LK.party.map(p => [p.id, p.hp, p.lv]))));
  } else break;
}
// Gerald
for (let i = 0; i < 40; i++) { const s = await lk(page); if (s.busy) break; await hold(page, ['ArrowRight'], 400); }
console.log('gerald scene', JSON.stringify((await lk(page)).player));
say(await talkThrough(page, [0], { until: s => s.mode === 'battle', onLine: async (s, n) => { if (n === 4) await shot(page, 'p10_gerald'); } }));
await sleep(2000);
say(await fight(page, { onMenu: async () => { await shot(page, 'p11_bossfight'); } }));
say(await talkThrough(page, [0], { onLine: async (s, n) => { if (s.dlg && s.dlg.startsWith('Citizens')) await shot(page, 'p12_relight_gather'); if (s.dlg && s.dlg.startsWith('Magnificent')) await shot(page, 'p13_relit'); if (s.dlg && s.dlg.startsWith('So pretty')) await shot(page, 'p14_roof'); }, until: s => s.mode === 'ending' }));
await sleep(4000);
await shot(page, 'p15_ending');
console.log('final', JSON.stringify(await lk(page)), JSON.stringify(await page.evaluate(() => LK.stats)));
console.log('errors', logs.length);
await browser.close();
