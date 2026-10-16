---
name: pixel-art
description: House quality bar for pixel-art / 8-bit / 16-bit games and animated scenes in this repo (single-file HTML, vanilla JS, Canvas 2D). Use whenever creating a new game under games/, building a pixel-art scene or sprite animation, or polishing the visuals, animation, palette or performance of an existing pixel game such as Iron Comet. Covers planning, fixed palettes, dithering, procedural sprites, pose animation, particles, camera, the zero-allocation loop, and verification with tools/pixel-lint.mjs.
---

# Pixel-art quality bar

The target: **it should look like a polished 16-bit game or cutscene, not vector shapes scaled down.**
Every rule below can be checked. When a rule and a shortcut disagree, keep the rule.

Start new work from `template.html` in this folder. It already implements the rendering contract,
the palette, dithering, a rim-lit procedural sprite, pooled particles, the state machine and the
fixed-step loop, and it passes `tools/pixel-lint.mjs`. `references/exemplar-prompts.md` holds the
two prompts that set this bar. Read them once; they show how specific the plan needs to be.

## 0. Plan before code

Write a short plan into the conversation before writing the file. It must contain:

1. **Resolution** (e.g. 320x180, 256x144, 128x96) and any letterbox, with the integer-scale rule.
2. **Palette table**: every colour in hex, grouped into ramps, each with its job (see §2).
   Name the grade (e.g. "golden hour, teal-orange: warm lights, cool shadows").
3. **Layers back to front** with parallax rates (e.g. sky 0.1, far 0.25, mid 0.45, play 1.0, fg 1.4).
4. **Sprites**: size in pixels, the parts, and the **pose parameters** that drive each one.
5. **State machine(s)**: states, durations, what each pose parameter does in each state, and how the loop closes.
6. **Particles**: kinds, budget (pool size), each kind's colour ramp across its life.
7. **Camera / shots**: what it frames when, its easing, shake amounts.
8. **Juice list** (games): hit-stop, flashes, shake, squash, telegraphs, sound cues.

## 1. Rendering contract

- One fixed **logical resolution**. Draw only there, then blit to the display canvas at the **largest
  integer scale** that fits, centred on black. `imageSmoothingEnabled = false` on every context, and
  CSS `image-rendering: pixelated`. (On phones, a non-integer "fill" scale is acceptable for the
  touch layout only. Desktop stays integer.)
- **Integer coordinates only.** Round at the draw call (`x | 0`, `Math.round`), never let a float reach
  `fillRect`/`drawImage`. This also keeps V8 from boxing floats across calls (§7).
- **No** gradients, `shadowBlur`, `filter`, `globalAlpha`, `rgba()`, or blend modes on the game canvas.
  Every soft transition (sky, glow, haze, light shafts, vignette, fades, shadows) is **ordered 4x4
  Bayer dithering between two adjacent ramp colours**. Fades and flashes use dither levels or palette
  swaps, not alpha.
- Preferred architecture (the template's): an **indexed framebuffer** (`Uint8Array` of palette
  indices) converted through a `Uint32Array` LUT once per frame. Every pixel is a palette index by
  construction, and palette swaps (hit flash, night grade, damage tint) are just a different LUT or
  index remap. A game that draws with `fillRect` instead must route **every** colour through palette
  constants. No ad-hoc hex in drawing code, and no runtime `shade()`/`mix()` producing new colours.
- Expose the lint hook before the first frame:
  `window.PIXEL = { canvas: logicalCanvas, palette: PAL, scenes: { name: () => jumpToState } }`.

## 2. Palette

- A fixed list of hex colours declared once, at the top. **Every pixel on screen comes from it.**
- Sizes: a single sprite scene ~16-24, a cinematic scene ~32-40, a whole game a **shared core ≤ 48**
  (characters, UI, FX, props) plus **≤ 32 per stage/area**. Aim for ≤ 64 distinct colours on screen at once.
- Organise it in **ramps** of 3-5 steps, dark→light, each with a job: "sky top→horizon", "far hills",
  "grass shadow→highlight", "skin shadow/mid/light", "rim light", "outline", "UI".
- **Hue-shift the ramps**: shadows lean cool (toward blue/violet/teal), highlights lean warm (toward
  yellow/orange). Never make a ramp by scaling one colour's brightness; that gives mud.
- **Value structure**: the background is low-contrast and close in value to the sky (atmospheric
  perspective: farther = lighter, hazier, more desaturated, cooler). The player character carries
  the highest contrast and the most saturated colour on screen.
- Keep two near-blacks: one for outlines/letterbox, one slightly lifted for foreground silhouettes.
- Per-stage moods (sunset, night, storm) are separate **sub-palettes** (or LUT remaps of the core),
  designed by hand. Do not multiply colours at runtime.

## 3. Light and atmosphere

- Pick one **key light** per scene (the sun, the moon, a lantern, the spell gem) and keep its direction consistent.
- **Rim light**: a 1px hot colour on the sprite edges facing the key light, only where the shape is
  ≥ 2px deep (otherwise thin limbs turn into solid stripes). The side away from the light uses the
  cooler shadow step. When the sprite flips, flip the light direction too.
- **Cast shadows** stretch away from the light as dithered runs of the ground's shadow colour.
- Depth comes from parallax layers, atmospheric haze (dither the far layers toward the sky colour),
  and an out-of-focus **near-black foreground silhouette** layer (grass, branches, posts) scrolling faster than the play layer.
- Optional polish: dithered god rays whose dither offset shifts every few frames (shimmer), a dithered
  vignette, 1px foliage sway on a slow cycle, twinkling 1px stars.

## 4. Characters and sprites

- Build sprites **procedurally** from rects, pixel runs and thick Bresenham lines into a small
  sprite buffer, then run the **rim pass** and a **1px outline pass**, then blit (flipped by facing).
- Size for readability: ~16x28 to ~24x32 for a hero at 320x180. Exaggerate the head, hat, hair,
  weapon or tool: the silhouette must read in solid black.
- Depth by painter's order: far limbs in the shadow step, then body, head, near limbs in the lit step.
- Drive everything from **named pose parameters** (lean, leg/knee angles, arm/elbow angles, bob,
  head tilt, hem/cape/hair/scarf sway, tool angle). Update them smoothly every tick, but **sample the
  displayed pose at 8-12 fps** (e.g. copy every 5th tick at 60 Hz) and snap joints to whole pixels.
  This is what makes motion read as hand-keyed frames instead of shimmering vectors.
- Give the hero an identity accent (scarf, hat, cape) that moves with secondary motion.

## 5. Animation

- **State machines** with explicit durations: e.g. IDLE → CHARGE → CAST → RECOVER, or WALK → LIFT → POUR → SETTLE.
  Loops must close seamlessly (end state equals start state, camera included).
- **Ease** between keyframes (`easeInOutCubic`). Add **anticipation** before big actions, a **held
  beat** at the climax, and **follow-through** on secondary parts.
- Idle is never frozen: 2-frame bob, breathing, cape or hair sway.
- Telegraph enemy attacks (flash, wind-up pose, "!") at least 0.3 s before they land.

## 6. Particles

- A **pooled struct-of-arrays** system: `Float32Array` x/y/vx/vy/life/max plus a free-list.
  Preallocate (~256-512). Spawning takes a slot and never allocates. A full pool drops the spawn.
- Each particle steps through a **palette ramp by age** (e.g. white → bright → mid → dark), drawn at rounded coordinates.
- Typical kinds: sparks (orbit, then burst), dust/debris on landing, smoke puffs (dithered discs that
  thin out as they age), water drops with splash children, ambient motes that glint.

## 7. Engine: fixed step, zero allocation

- `requestAnimationFrame` render. Fixed **60 Hz** update with an accumulator, capped catch-up (≤ 4-5 steps).
- **Nothing in the per-frame path allocates.** Concretely:
  - no object/array literals, `[a, b]` returns, destructuring of fresh arrays, `{...}` option bags, or `Object.assign` per frame;
  - no `.map/.filter/.forEach` with closures, and no closures created per frame. Compact arrays in place (swap-remove);
  - no string building (`String(n).padStart`, template literals, `+` concat, `toUpperCase`) per frame.
    Draw numbers digit by digit, cache strings that only change on events;
  - pattern/sprite caches keyed by numbers or nested arrays, never by concatenated strings;
  - scratch outputs go in a module-level `Float64Array` (e.g. a joint solver writes `J[0], J[1]`);
  - floats that change every frame should not live in module-level `let`s captured by closures. Keep
    them in a typed array or an object field. Round floats to ints before passing them to
    non-inlined helpers. Both of these avoid V8 boxing every write.
- `tools/pixel-lint.mjs` measures the steady-state allocation rate. A few tens of KB/s is residual
  float boxing and fine. Hundreds of KB/s means real per-frame garbage, so find it in the "Top" list.
- Audio: WebAudio nodes per note are expected. Schedule them from the music clock, not from draw code.

## 8. Camera

- World wider than the screen. The camera position is a float eased toward a target and **rounded when drawn**.
- Frame with the **rule of thirds** (hero a third in from the side they're facing, more room ahead).
  Ease in and out, never cut. Push in or reframe for key moments.
- Screen shake: 1-2 px for hits and casts, integer offsets, decays in a fraction of a second.
  Bigger only for set pieces (crash, boss landing).

## 9. Game feel (games, not just scenes)

- **Hit-stop** 50-80 ms on landed hits, a 1-2 frame white flash (palette swap) on the struck sprite,
  a small shake, a particle burst and a sound, all on the same frame.
- Input: buffer jump/attack presses ~100 ms, coyote time ~80 ms, and show the action within one frame of input.
- HUD in a **hand-drawn pixel font** (3x5 or 5x7), with a 1px shadow or outline. Numbers are drawn without per-frame strings.
- Every threat is readable: contrast against the background, a telegraph, and a sound.
- Touch: on-screen controls drawn as small pixel canvases, landscape prompt on phones (see Iron Comet).

## 10. Verify: the definition of done

1. `node tools/pixel-lint.mjs games/<slug>/index.html` passes with no FAIL:
   palette-pixels, integer-scale, no gradients/blur/network, no page errors, and the alloc-rate under the fail line.
2. **Look at the captures** it writes (3x PNGs, one set per `PIXEL.scenes` entry) with the Read tool. Check:
   - Does the hero's silhouette read instantly against the background?
   - Is the background lower contrast than the hero?
   - Any banding where a dither should be, or a stray off-ramp colour?
   - Are the shadows cool and the highlights warm?
   - Fix what you see, then re-run.
3. Play it in the browser via Playwright for the states the captures miss: input response, hit
   feedback, the loop closing seamlessly.
4. For a new game, follow the repo checklist in `CLAUDE.md`: catalogue entry, cover image, README row.
