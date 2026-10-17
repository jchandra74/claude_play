import { open, sleep, shot, lk } from './playtest.mjs';
import { walkTo, face, press, talkThrough, fight, talkTo, hold } from './drive.mjs';
const { browser, page, logs } = await open('dtmax=0.3&scene=forest' + (process.env.NOPOST ? '&nopost' : ''), { width: 640, height: 300 });
const say = (l) => l.forEach(x => console.log('   ', x));
await sleep(1500);
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
