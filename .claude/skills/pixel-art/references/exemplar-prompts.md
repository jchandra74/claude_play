# Exemplar prompts

These two prompts produced output at the quality this repo wants. They work because nearly every line
is a constraint you can check. Reuse their structure (RENDERING / PALETTE / CAMERA / CHARACTER /
ANIMATION / SCENE / QUALITY BAR) when you write the plan for a new game or scene.

---

## 1. Golden-hour garden (cinematic scene)

Create a single self-contained HTML file that renders a cinematic animated pixel art scene of a woman tending her front-yard garden on a quiet, secluded hillside at golden hour, walking between flower beds and watering her plants with a metal watering can, using vanilla JavaScript and Canvas 2D. No external assets, libraries, or network requests.

RENDERING

* Draw everything to an offscreen canvas at a fixed logical resolution of 320x180, with a cinematic 2.39:1 letterbox: solid near-black bars top and bottom leaving a 320x134 image area. Blit to a fullscreen display canvas scaled by the largest integer factor that fits the window, centered on a black background, with imageSmoothingEnabled = false and CSS image-rendering: pixelated.
* All drawing snaps to integer coordinates on the logical canvas. No sub-pixel positions, anti-aliasing, gradients, or shadowBlur. Any soft falloff (sky, light shafts, vignette, haze) is done with ordered Bayer dithering between adjacent palette colors, never true gradients.
* Fixed palette of ~40 hex colors, color-graded for warm golden hour with cool shadows (teal-orange grade): sky (4 steps from deep peach at the horizon through warm gold to dusty lavender-blue at the top), sun disc and glow (2 warm whites/pale golds), distant hills and treeline (3 hazy desaturated blue-violets for atmospheric perspective), mid-ground grass and foliage (4 greens, highlights warm yellow-green, shadows cool teal-green), soil (dry tan, mid brown, wet dark brown), flowers (2 pinks, 2 yellows, 1 lavender, 1 cream), cottage and fence (warm cream, sunlit wood, shadowed wood, dark trim), character skin (light, mid, shadow), clothing (straw hat gold + shadow, sage sundress + cool shadow, off-white apron), watering can (light, mid, dark grey plus a warm specular), water (white, light cyan, mid blue), rim light (1 hot warm gold), and 2 near-blacks for letterbox, outline, and foreground silhouettes. Every pixel comes from this palette.

CAMERA

* The world is wider than the frame (~480 logical px). A virtual camera with integer x offset drifts slowly and eases between shots; parallax layers scroll at different rates (sky 0.1, far hills 0.25, treeline 0.45, yard 1.0, foreground 1.4) to create depth.
* Shot sequence tied to the state machine: open on a WIDE establishing shot (slow dolly across the hillside revealing the cottage and yard), then the camera eases to follow her as she walks, and during POUR it pushes in by panning to frame her and the flower bed off-center using the rule of thirds. Camera motion eases in and out, never cuts abruptly. Quantize camera position to whole pixels.

CHARACTER

* Build the woman procedurally from filled rects and pixel runs, ~16x28 logical pixels: wide-brimmed straw sun hat that overhangs the face, loose strands of hair catching the wind, low bun, sage sundress flaring at the hem, short apron, bare forearms, simple dark shoes, and a watering can held in her right hand with a long spout. Side-view profile, flipped horizontally to face the direction of travel.
* Backlit by the low sun: a 1-pixel hot gold rim light along her back-facing edge (hat brim, shoulder, arm, dress edge), with the front of her body in cooler shadow tones.
* Parameterize the pose (x position, facing direction, walk cycle phase, body bob, arm raise angle, can tilt angle, head tilt, hem sway, hair strand sway). Animate parameters smoothly, then quantize to the pixel grid each frame so motion reads at an 8-12 fps pixel animation feel even though the loop runs at 60fps.

ANIMATION

* Looping state machine: WALK (she strolls along the stone path to the next flower bed, can swinging gently, hat and hem bobbing, hair drifting) -> LIFT (she stops, turns toward the bed, raises the can) -> POUR (she tilts the can and water arcs from the spout onto the plants, sweeping slowly across the bed, head tilted down) -> SETTLE (she lowers the can, pauses, lifts her head to gaze out at the view toward the sun for a held beat, then turns toward the next bed). Visit 3 beds, then walk back so the loop is seamless, with the camera returning to the establishing shot at the loop point. Ease pose parameters between keyframes.
* Pooled allocation-free particle system: preallocate and reuse (~300 particles). During POUR, emit a stream of water droplets from the spout tip with slight spread and gravity; on landing they spawn 2-3 tiny splash particles. Droplets passing in front of the sun flash to white for one frame (backlit sparkle). During WALK, occasionally drip a single drop. Ambient: floating dust motes and pollen that drift slowly through the light shafts and glint gold, plus 1-2 butterflies. Each water particle steps its palette index from white to light cyan to mid blue before despawn. Snap particle positions to the grid when drawing.
* Watered soil darkens from dry tan to wet dark brown, then dries back over the loop. Watered flowers give a small 1-pixel perk-up bounce.
* Fixed 60hz timestep update with rAF rendering. Zero object allocation inside the loop.

SCENE

* Layered for depth, back to front: dithered golden-hour sky with the low sun near the horizon and 2 slow-drifting clouds lit from below; hazy far hills and a dark distant treeline in desaturated violet (atmospheric perspective); the cottage corner with porch step and window box, fence, and 3 raised flower beds along a sloping stone path in the mid-ground; out-of-focus foreground framing elements (dark silhouetted tall grass and a leafy branch hanging into the top corner, drawn in near-black with simplified shapes to read as shallow depth of field) that pass slowly across the frame with the camera.
* Keep background contrast low and the character the brightest-edged, highest-contrast element so her silhouette reads clearly.
* Lighting: 3-4 diagonal god rays from the sun, rendered as dithered warm bands over the midground that slowly shimmer (dither pattern offset shifts every few frames). Long cool shadows stretch from the fence, beds, and character away from the sun. A subtle dithered vignette darkens the corners of the image area. Foliage sways 1 pixel on a slow breeze cycle.

QUALITY BAR

* Crisp pixels at any window size, seamless loop, stable 60fps, readable silhouette. Should look like a polished 16-bit cinematic cutscene, the kind of quiet establishing moment from a narrative pixel game, not vector shapes scaled down. Mood: calm, warm, nostalgic, and serene. plan it out and then make the scene

---

## 2. Wizard casting a spell (sprite animation)

Create a single self-contained HTML file that renders an animated pixel art wizard casting a spell, using vanilla JavaScript and Canvas 2D. No external assets, libraries, or network requests.

RENDERING

- Draw everything to an offscreen canvas at a fixed logical resolution of 128x96, then blit to a fullscreen display canvas scaled by the largest integer factor that fits the window, centered, with imageSmoothingEnabled = false and CSS image-rendering: pixelated.
- All drawing snaps to integer coordinates on the logical canvas. No sub-pixel positions, anti-aliasing, gradients, or shadowBlur.
- Fixed palette of ~24 hex colors: deep blues/purples for night sky, warm robe tones, 3-4 bright magic colors. Every pixel comes from this palette.

CHARACTER

- Build the wizard procedurally from filled rects and pixel runs, ~24x32 logical pixels: pointed hat with a bend, long beard, two-shade robe with darker outline, staff with a gem at the tip.
- Parameterize the pose (staff angle, arm raise, head tilt, robe sway). Animate parameters smoothly, then quantize to the pixel grid each frame so motion reads at an 8-12 fps pixel animation feel even though the loop runs at 60fps.

ANIMATION

- Looping state machine: IDLE (2-frame bob, beard sway) -> CHARGE (staff raises, gem flickers, sparks spiral inward) -> CAST (bright burst, projectile fires across the scene, 1-2 pixel screen shake) -> RECOVER (settle back). Ease pose parameters between keyframes.
- Pooled allocation-free particle system: preallocate and reuse. Sparks orbit the gem during CHARGE, explode outward on CAST, each particle stepping its palette index from white to magic color to dark before despawn. Snap particle positions to the grid when drawing.
- Fixed 60hz timestep update with rAF rendering. Zero object allocation inside the loop.

SCENE

- Minimal background: dark sky, a few twinkling 1px stars, moon, stone floor line. Character silhouette must read clearly.
- Subtle 1px rim light on the wizard from the gem, brightening during CHARGE and CAST.

QUALITY BAR

- Crisp pixels at any window size, seamless loop, stable 60fps, readable silhouette. Should look like a polished 16-bit sprite animation, not vector shapes scaled down.
