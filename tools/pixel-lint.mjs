#!/usr/bin/env node
/*
 * pixel-lint: checks a single-file pixel-art game against the repo's quality bar
 * (.claude/skills/pixel-art/SKILL.md).
 *
 *   node tools/pixel-lint.mjs games/<slug>/index.html [--seconds 4] [--out dir] [--scene name ...]
 *
 * Static checks (source text): no gradients / shadowBlur / CSS filters, no network, smoothing off,
 * pixelated CSS, rAF loop present.
 * Runtime checks (headless Chromium): no page errors, every pixel of the logical canvas is in the
 * declared palette, per-frame colour count, integer display scale at several window sizes,
 * steady-state JS allocation rate inside the loop, and upscaled PNG captures to look at.
 *
 * Games opt in to the precise checks by exposing a hook before their first frame:
 *   window.PIXEL = {
 *     canvas,                 // the logical-resolution canvas everything is drawn to
 *     palette: ['#rrggbb'],   // every colour that may appear on screen
 *     scenes: { name: () => void },  // optional: jump to states worth capturing
 *   };
 * Without the hook the largest canvas is captured and only colour counts are reported.
 *
 * Exit code: 0 = pass (warnings allowed), 1 = at least one FAIL.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = { seconds: 4, warmup: 4, out: null, scenes: [], file: null, allocWarnKBs: 64, allocFailKBs: 256 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--seconds') opt.seconds = +argv[++i];
  else if (a === '--warmup') opt.warmup = +argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--scene') opt.scenes.push(argv[++i]);
  else if (a === '-h' || a === '--help') { console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); process.exit(0); }
  else opt.file = a;
}
if (!opt.file) { console.error('usage: node tools/pixel-lint.mjs <game.html> [--seconds N] [--out dir] [--scene name]'); process.exit(2); }
const file = resolve(opt.file);
const src = readFileSync(file, 'utf8');
opt.out = resolve(opt.out || join(process.env.TMPDIR || '/tmp', 'pixel-lint', basename(dirname(file))));
mkdirSync(opt.out, { recursive: true });

// ---------- reporting ----------
const results = [], shots = [];
const report = (level, check, msg) => results.push({ level, check, msg });
const PASS = (c, m) => report('PASS', c, m), WARN = (c, m) => report('WARN', c, m), FAIL = (c, m) => report('FAIL', c, m);

// ---------- static checks ----------
const lines = src.split('\n');
const grepLines = re => { const out = []; lines.forEach((l, i) => { if (re.test(l)) out.push(i + 1); }); return out; };
const fmtLines = ls => ls.slice(0, 8).join(', ') + (ls.length > 8 ? ` (+${ls.length - 8} more)` : '');
function staticCheck(name, re, level, why) {
  const hit = grepLines(re);
  if (hit.length) report(level, name, `${why} at line ${fmtLines(hit)}`); else PASS(name, 'none');
}
staticCheck('no-gradients', /create(Linear|Radial|Conic)Gradient/, 'FAIL', 'true gradient (use Bayer dithering between palette colours)');
staticCheck('no-shadowBlur', /shadowBlur|shadowColor/, 'FAIL', 'shadowBlur/shadowColor');
staticCheck('no-ctx-filter', /\.filter\s*=\s*['"`](?!none)/, 'FAIL', 'canvas filter');
staticCheck('no-network', /\b(fetch\(|XMLHttpRequest|import\s*\(|<script[^>]+src=|<link[^>]+href=["']https?:|url\(\s*["']?https?:)/, 'FAIL', 'network request / external asset');
staticCheck('blend-modes', /globalCompositeOperation\s*=\s*['"](?!source-over)/, 'WARN', 'blend mode creates off-palette pixels (OK only on UI layers outside the logical canvas)');
staticCheck('alpha', /globalAlpha\s*=\s*(?!1\b)|rgba\(|hsla\(/, 'WARN', 'alpha blending creates off-palette pixels (OK only on UI layers outside the logical canvas)');
if (/imageSmoothingEnabled\s*=\s*false/.test(src)) PASS('smoothing-off', 'imageSmoothingEnabled = false'); else FAIL('smoothing-off', 'imageSmoothingEnabled = false not found');
if (/image-rendering:\s*pixelated/.test(src)) PASS('css-pixelated', 'image-rendering: pixelated'); else FAIL('css-pixelated', 'CSS image-rendering: pixelated not found');
if (/requestAnimationFrame/.test(src)) PASS('raf', 'requestAnimationFrame loop'); else FAIL('raf', 'no requestAnimationFrame loop');
if (/setInterval\s*\(/.test(src)) WARN('timers', `setInterval at line ${fmtLines(grepLines(/setInterval\s*\(/))} (prefer the fixed-step loop)`);

// ---------- playwright ----------
async function loadPlaywright() {
  try { return await import('playwright'); } catch (_) {}
  try { const root = execSync('npm root -g', { encoding: 'utf8' }).trim(); return createRequire(join(root, 'noop.js'))('playwright'); } catch (_) {}
  return null;
}
const pw = await loadPlaywright();
if (!pw) { FAIL('runtime', 'playwright not found (npm i -g playwright); runtime checks skipped'); finish(); }

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: false });
const page = await ctxB.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const requests = [];
page.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u); });

await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(800);

// Locate the logical canvas + palette.
const hook = await page.evaluate(() => {
  const P = window.PIXEL;
  if (P && P.canvas) return { hooked: true, w: P.canvas.width, h: P.canvas.height, palette: (P.palette || []).map(c => String(c).toLowerCase()), scenes: P.scenes ? Object.keys(P.scenes) : [] };
  const cs = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
  if (!cs.length) return null;
  window.__lintCanvas = cs[0];
  return { hooked: false, w: cs[0].width, h: cs[0].height, palette: [], scenes: [] };
});
if (!hook) { FAIL('canvas', 'no canvas found'); await browser.close(); finish(); }
if (hook.hooked) PASS('pixel-hook', `window.PIXEL: ${hook.w}x${hook.h}, ${hook.palette.length} palette colours, scenes: ${hook.scenes.join(', ') || '(none)'}`);
else WARN('pixel-hook', `no window.PIXEL hook; using largest canvas ${hook.w}x${hook.h}, palette unknown`);
if (hook.palette.length) {
  const bad = hook.palette.filter(c => !/^#[0-9a-f]{6}$/.test(c));
  if (bad.length) FAIL('palette-format', `non #rrggbb entries: ${bad.slice(0, 5).join(', ')}`);
  const dup = hook.palette.filter((c, i) => hook.palette.indexOf(c) !== i);
  if (dup.length) WARN('palette-dupes', `duplicate entries: ${[...new Set(dup)].join(', ')}`);
}

// Capture helper: histogram of the logical canvas, plus raw RGBA for a PNG.
async function capture() {
  return page.evaluate(() => {
    const c = (window.PIXEL && window.PIXEL.canvas) || window.__lintCanvas;
    let d;
    try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; }
    catch (_) { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const g = t.getContext('2d'); g.drawImage(c, 0, 0); d = g.getImageData(0, 0, c.width, c.height).data; }
    const hist = {};
    for (let i = 0; i < d.length; i += 4) { const k = ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]).toString(16).padStart(6, '0'); hist[k] = (hist[k] || 0) + 1; }
    let b = ''; for (let i = 0; i < d.length; i += 4096) b += String.fromCharCode.apply(null, d.subarray(i, i + 4096));
    return { w: c.width, h: c.height, hist, rgba: btoa(b) };
  });
}

// Minimal PNG writer (nearest-neighbour upscale) so captures can be inspected without extra deps.
function writePNG(path, w, h, rgba, scale = 3) {
  const W = w * scale, H = h * scale, raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; for (let x = 0; x < W; x++) { const s = ((y / scale | 0) * w + (x / scale | 0)) * 4, o = y * (W * 4 + 1) + 1 + x * 4; raw[o] = rgba[s]; raw[o + 1] = rgba[s + 1]; raw[o + 2] = rgba[s + 2]; raw[o + 3] = 255; } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---------- palette + colour count per scene ----------
const pal = new Set(hook.palette.map(c => c.slice(1)));
const sceneList = opt.scenes.length ? opt.scenes : hook.scenes.length ? hook.scenes : ['default'];
let worstOff = 0, worstOffScene = '', maxColours = 0, offTally = {};
for (const sc of sceneList) {
  if (sc !== 'default') {
    const ok = await page.evaluate(n => { const f = window.PIXEL && window.PIXEL.scenes && window.PIXEL.scenes[n]; if (!f) return false; f(); return true; }, sc);
    if (!ok) { WARN('scene', `scene "${sc}" not found in PIXEL.scenes`); continue; }
  }
  for (let k = 0; k < 3; k++) {
    await page.waitForTimeout(k === 0 ? 1200 : 700);
    const cap = await capture();
    const name = `${sc}-${k}.png`;
    writePNG(join(opt.out, name), cap.w, cap.h, Buffer.from(cap.rgba, 'base64'));
    shots.push(join(opt.out, name));
    const cols = Object.keys(cap.hist);
    maxColours = Math.max(maxColours, cols.length);
    if (pal.size) {
      let off = 0; for (const c of cols) if (!pal.has(c)) { off += cap.hist[c]; offTally[c] = (offTally[c] || 0) + cap.hist[c]; }
      if (off > worstOff) { worstOff = off; worstOffScene = `${sc}#${k}`; }
    }
  }
}
if (pal.size) {
  const top = Object.entries(offTally).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => `#${c}×${n}`).join(' ');
  if (worstOff === 0) PASS('palette-pixels', `every captured pixel is in the ${pal.size}-colour palette`);
  else FAIL('palette-pixels', `${worstOff} off-palette pixels in ${worstOffScene}; ${Object.keys(offTally).length} distinct off-palette colours, top: ${top}`);
  if (pal.size > 64) WARN('palette-size', `${pal.size} colours declared (scene target ~24-40, whole game <= 64 per frame)`);
}
if (maxColours > 64) WARN('frame-colours', `up to ${maxColours} distinct colours in one frame (target <= 64; ~24-40 per scene)`);
else PASS('frame-colours', `max ${maxColours} distinct colours per frame`);

// ---------- integer scaling at several window sizes ----------
const sizes = [[1280, 720], [1366, 768], [1920, 1080], [1000, 700], [800, 600]];
const scaleBad = [];
for (const [vw, vh] of sizes) {
  await page.setViewportSize({ width: vw, height: vh });
  await page.waitForTimeout(150);
  const r = await page.evaluate(([lw, lh]) => {
    const cs = [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 0).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const c = cs[0]; if (!c) return null; const rc = c.getBoundingClientRect(), st = getComputedStyle(c);
    // display canvas may itself be at logical size (CSS-scaled) or at the scaled size (drawn with drawImage)
    return { sx: rc.width / lw, sy: rc.height / lh, ir: st.imageRendering, inside: rc.width <= innerWidth + 0.5 && rc.height <= innerHeight + 0.5 };
  }, [hook.w, hook.h]);
  if (!r) continue;
  const okInt = Math.abs(r.sx - Math.round(r.sx)) < 0.01 && Math.abs(r.sy - Math.round(r.sy)) < 0.01 && Math.round(r.sx) >= 1;
  if (!okInt || Math.abs(r.sx - r.sy) > 0.01 || !r.inside || !/pixelated|crisp-edges/.test(r.ir)) scaleBad.push(`${vw}x${vh}→${r.sx.toFixed(2)}x${r.sy.toFixed(2)}${/pixelated|crisp/.test(r.ir) ? '' : ' (not pixelated)'}${r.inside ? '' : ' (overflows)'}`);
}
if (scaleBad.length) FAIL('integer-scale', `non-integer or overflowing display scale: ${scaleBad.join(', ')}`); else PASS('integer-scale', `integer scale at ${sizes.map(s => s.join('x')).join(', ')}`);
await page.setViewportSize({ width: 1280, height: 720 });

// ---------- frame cadence + allocation rate ----------
const cdp = await ctxB.newCDPSession(page);
if (sceneList[0] !== 'default') await page.evaluate(n => window.PIXEL.scenes[n](), sceneList[sceneList.length > 1 ? 1 : 0]);
await page.waitForTimeout(opt.warmup * 1000); // let caches fill and the JIT tier up before measuring
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const cadence = await page.evaluate(sec => new Promise(res => {
  const ts = []; const t0 = performance.now();
  const f = t => { ts.push(t); if (t - t0 < sec * 1000) requestAnimationFrame(f); else res(ts); };
  requestAnimationFrame(f);
}), opt.seconds);
const prof = await cdp.send('HeapProfiler.stopSampling');
// Sum allocation by function (self size), page script only.
const byFn = new Map(); let total = 0;
const walk = n => {
  const self = n.selfSize || 0, cf = n.callFrame, own = cf.url && cf.url.startsWith('file:');
  if (self) { total += self; if (own) { const k = `${cf.functionName || '(anonymous)'}:${cf.lineNumber + 1}`; byFn.set(k, (byFn.get(k) || 0) + self); } }
  (n.children || []).forEach(walk);
};
walk(prof.profile.head);
const ownTotal = [...byFn.values()].reduce((a, b) => a + b, 0);
const kbs = ownTotal / 1024 / opt.seconds;
const topFns = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1024 / opt.seconds).toFixed(1)}KB/s`).join('; ');
const lvl = kbs > opt.allocFailKBs ? FAIL : kbs > opt.allocWarnKBs ? WARN : PASS;
lvl('alloc-rate', `${kbs.toFixed(1)} KB/s allocated by game code in steady state (warn >${opt.allocWarnKBs}, fail >${opt.allocFailKBs}; a few tens of KB/s is float boxing across calls, hundreds means objects/arrays/closures/strings per frame)${topFns ? '. Top: ' + topFns : ''}`);

const iv = []; for (let i = 1; i < cadence.length; i++) iv.push(cadence[i] - cadence[i - 1]);
iv.sort((a, b) => a - b);
const p50 = iv[iv.length >> 1] || 0, p95 = iv[Math.floor(iv.length * 0.95)] || 0;
const fps = 1000 / (p50 || 1);
(p95 > 25 ? WARN : PASS)('frame-cadence', `rAF p50 ${p50.toFixed(1)}ms (${fps.toFixed(0)}fps), p95 ${p95.toFixed(1)}ms over ${opt.seconds}s (headless timing is indicative only)`);

if (errors.length) FAIL('page-errors', errors.slice(0, 5).join(' | ')); else PASS('page-errors', 'none');
if (requests.length) FAIL('network-requests', requests.slice(0, 5).join(', ')); else PASS('network-requests', 'none');

await browser.close();
finish();

function finish() {
  const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
  console.log(`\npixel-lint ${opt.file}\n`);
  for (const r of results) console.log(`  ${icon[r.level]} ${r.level.padEnd(4)} ${r.check.padEnd(16)} ${r.msg}`);
  if (shots.length) console.log(`\n  captures (3x, look at them): ${opt.out}/\n    ${shots.map(s => basename(s)).join(' ')}`);
  const fails = results.filter(r => r.level === 'FAIL').length, warns = results.filter(r => r.level === 'WARN').length;
  console.log(`\n  ${fails ? 'FAIL' : 'PASS'}: ${fails} fail, ${warns} warn\n`);
  process.exit(fails ? 1 : 0);
}
