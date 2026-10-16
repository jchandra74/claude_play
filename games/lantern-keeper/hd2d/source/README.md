# HD-2D plaza (prototype)

A 3D rebuild of Wickhollow's plaza at night in the HD-2D style, made over three builder/judge rounds against Octopath Traveler screenshots. `../index.html` is the built, self-contained page; this folder is its source.

- `src/`: three.js scene modules (layout, terrain, buildings, plaza, props, characters, lighting, particles, post-processing).
- `assets/native/`: the pixel art (generated with ChatGPT Images, then cut and downscaled). `px_*.png` are the same art resized onto the scene's shared 56 px-per-metre grid.
- `assets/pxgrid.py` makes the `px_*` files; it needs the full-resolution cut-outs (`assets/sprites/`), which are not committed.

```
npm install          # three@0.169.0
node build.mjs       # writes dist/plaza.html
node shoot.mjs full  # 1920x1080 screenshot via headless Chromium
```

URL parameters: `?view=full|house|lantern|characters|terrain|tree`, `?quality=low|med|high`.
