// Build: inline three.js, every src module and every PNG into one self-contained dist/plaza.html.
// Modules are mapped through an import map to base64 data: URLs; relative imports are rewritten to '@/x.js'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const b64 = (s) => Buffer.from(s).toString('base64');
const three = fs.readFileSync(path.join(root, 'node_modules/three/build/three.module.min.js'), 'utf8');
const imports = { three: 'data:text/javascript;base64,' + b64(three) };
for (const f of fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js'))) {
  let code = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  code = code.replace(/from\s+'\.\/([\w-]+\.js)'/g, "from '@/$1'");
  imports['@/' + f] = 'data:text/javascript;base64,' + b64(code);
}
const assetDir = path.join(root, 'assets/native');
const assets = {};
for (const f of fs.readdirSync(assetDir).filter(f => f.endsWith('.png'))) {
  assets[f.replace(/\.png$/, '')] = 'data:image/png;base64,' + fs.readFileSync(path.join(assetDir, f)).toString('base64');
}
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wickhollow Plaza</title>
<style>html,body{margin:0;height:100%;background:#05070d;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script>window.__ASSETS=${JSON.stringify(assets)};</script>
</head><body>
<script type="module">import '@/main.js';</script>
</body></html>`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/plaza.html'), html);
console.log('wrote dist/plaza.html', (html.length / 1024 / 1024).toFixed(2), 'MB');
