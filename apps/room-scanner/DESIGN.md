# Room Scanner: design doc

Status: M0 (the `core` library and the plan-to-GLB tool) is built and tested. See `README.md`.
M1 onward (the Android app) is not started.
Working name: Room Scanner (placeholder; see open questions).

## 1. Summary

An Android app that uses the phone camera and ARCore to capture the structure of a room or a
house (walls, floor, ceiling, door and window openings, no furniture) and exports it as a clean,
true-to-scale 3D model that opens directly in Blender.

The capture is **guided**, not automatic: the user points the phone at structural corners and
taps. The app turns those taps into a parametric floor plan and generates the mesh from the plan.
Furniture never enters the model because it is never captured.

## 2. Goals and non-goals

### Goals (v1)

- Capture one room in under two minutes with a typical ARCore phone (no LiDAR or ToF needed).
- Dimensional error of about 1 to 2 percent in a single room, with a way to correct it against
  one tape-measured wall.
- Rectangular door and window openings, placed on walls.
- Multiple rooms in one project, joined at doorways.
- Export GLB that imports into Blender at real-world scale, with one named object per wall,
  floor and ceiling.
- Send the file to a PC through the Android share sheet.
- Works fully offline. No account, no backend.

### Non-goals (v1)

- Automatic wall detection from a free-form scan.
- Furniture, fixtures, textures or photo capture.
- Sloped ceilings, curved walls, stairs, multiple storeys.
- Arched or non-rectangular openings.
- iOS.
- Survey-grade accuracy. This is a modelling base, not a legal measurement.

## 3. User flow

1. **New project**, then **Add room** and give it a name.
2. **Find the floor.** The user sweeps the phone at the floor until ARCore detects it. The app
   shows a grid on the detected plane.
3. **Mark corners.** A reticle sits where the camera's centre ray meets the floor plane. The user
   aims it at each wall-floor corner in order around the room and taps. Each tap drops a post and
   draws the wall line from the previous corner. Aiming at the first post again closes the room.
4. **Set the height.** The user aims at the wall-ceiling edge above any wall and taps. See 5.3.
5. **Mark openings.** The app draws the walls as translucent panels. The user aims at two
   diagonal corners of a door or window on a wall and taps each. Type is door (sill at floor) or
   window.
6. **Review.** A 2D plan view shows the room with every wall length. The user can type a measured
   length for a wall, toggle "square corners", and rename things.
7. **Add another room** by walking through a doorway and repeating from step 3, or **Export**.
8. **Export** writes a GLB and opens the share sheet.

Undo removes the last tap at every step.

### When a corner is hidden by furniture

Floor corners are often blocked. Two fallbacks, both in v1 scope because without them the app
fails in most furnished rooms:

- **Wall mode.** Instead of the corner, the user taps two points along the visible base of each
  wall. Each wall becomes a line on the floor plane; corners are the intersections of adjacent
  wall lines.
- **Mixed.** Corner taps and wall taps can be mixed around the same room.

## 4. Architecture

Two Gradle modules. The split matters: everything that can be wrong numerically lives in a
module that runs and is tested on a plain JVM, without a phone.

```
apps/room-scanner/
  DESIGN.md
  core/      Pure Kotlin (JVM). No Android imports.
             model/      Project, Room, Wall, Opening
             geometry/   2D/3D maths, ray-plane, line intersection
             solve/      snapping, closure, constraint adjustment, room alignment
             mesh/       plan -> triangles
             export/     GLB writer, project JSON
  app/       Android application.
             ar/         ARCore session, reticle, hit tests, anchors
             ui/         Compose screens: projects, capture, plan review, export
             data/      project storage, share
```

```
ARCore frame ──> capture (ar/) ──> taps in world space
                                     │
                                     ▼
                          plan builder (core/solve)
                                     │
                                     ▼
                       Project model (core/model)  <──>  JSON on disk
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
              AR overlay + 2D plan            mesh (core/mesh)
                                                     │
                                                     ▼
                                              GLB (core/export) ──> share sheet
```

### Stack

| Concern | Choice | Why |
|---|---|---|
| Language | Kotlin | Standard for Android; `core` stays portable. |
| AR | ARCore SDK | Motion tracking, plane detection, depth. |
| AR rendering | SceneView (Filament) | Avoids writing a GL renderer for posts, lines and panels. |
| UI | Jetpack Compose | Capture HUD, plan view on a Compose `Canvas`. |
| Serialisation | kotlinx.serialization | Project JSON. |
| GLB | Own writer in `core` | The output is simple (positions, normals, indices); a small writer beats a dependency. |
| Backend | None | Files live in app storage. |

Permissions: `CAMERA` only. The app is marked AR Required, so it only installs on
ARCore-supported devices.

## 5. Capture

### 5.1 Session setup

- Plane finding: horizontal and vertical.
- Depth mode: automatic where supported. Depth is used only to help snapping (5.4); the app must
  work without it.
- The capture screen shows tracking state and refuses taps while tracking is not `TRACKING`.

### 5.2 Floor and corners

- The floor is the largest upward-facing horizontal plane near the lowest observed height. The
  user confirms it by starting to tap.
- A corner tap does **not** rely on ARCore finding a feature at the corner. It intersects the
  camera's centre ray with the floor plane analytically. This is what makes it work on plain
  walls and bare floors.
- Error grows with distance and with a shallow viewing angle. The reticle turns amber beyond
  about 4 m or below about 15 degrees of grazing angle, prompting the user to step closer.
- Each corner is stored as an ARCore anchor during the session, so it moves with tracking
  corrections. Positions are read from the anchors when the room is closed.

### 5.3 Ceiling height

Ceilings are usually blank, so plane detection on them is unreliable. Height is measured by
trigonometry instead: once walls exist, the user aims at the wall-ceiling edge. The app
intersects the centre ray with that wall's vertical plane; the hit point's height above the floor
is the ceiling height. One tap is enough for a flat ceiling. A second tap on another wall is
offered as a check, and the app warns if the two differ by more than 3 cm.

### 5.4 Snapping aids

- If ARCore has detected a vertical plane near the reticle, the corner snaps onto the line where
  that plane meets the floor.
- When a new wall is within 7 degrees of perpendicular or parallel to the previous one, the
  guide line snaps to it. Holding a "free angle" button disables this.
- Aiming near the first post snaps to it and closes the room.

### 5.5 Openings

With walls known, an opening tap intersects the centre ray with the wall's plane. Two diagonal
taps define a rectangle, stored relative to the wall (offset along the wall, sill height, width,
height). Doors force the sill to zero. The opening is clamped to the wall's extents.

## 6. Data model

The plan is 2D-first. A room is a polygon with a height; everything 3D is derived.

```jsonc
{
  "version": 1,
  "name": "Flat 3B",
  "units": "metric",                 // display only; storage is always metres
  "rooms": [{
    "id": "r1",
    "name": "Living room",
    "height": 2.42,
    "origin": { "x": 0.0, "z": 0.0, "yaw": 0.0 },   // room frame in project frame; yaw in radians
    "vertices": [ { "x": 0.0, "z": 0.0 }, { "x": 4.12, "z": 0.0 }, ... ],  // either winding; normalised on load
    "walls": [{
      "id": "w1",                    // wall i runs vertices[i] -> vertices[i+1]
      "lockedLength": null,          // metres, if the user typed a measurement
      "openings": [{
        "id": "o1", "type": "door",  // door | window
        "offset": 0.85,              // from the wall's start vertex, along the wall
        "sill": 0.0, "width": 0.82, "height": 2.03,
        "linkId": "L1"               // same id on the matching opening in the next room
      }]
    }]
  }],
  "settings": { "wallThickness": 0.10, "exportMode": "solid" }
}
```

Raw taps (world-space points and the camera pose for each) are kept beside the solved plan so
the solver can be re-run after an algorithm change without re-scanning.

## 7. Plan solving

Runs when a room is closed and again whenever the user edits a constraint.

1. **Project** tap points onto the floor plane and into the room's 2D frame.
2. **Wall mode intersections**: compute corners from adjacent wall lines; reject near-parallel
   pairs (under 10 degrees) and ask the user to re-tap.
3. **Angle snapping**: if "square corners" is on, each wall direction within 7 degrees of the
   room's dominant axes is snapped to it. The dominant axis is the length-weighted mode of wall
   directions.
4. **Closure**: the last wall rarely lands exactly on the first corner. The gap is distributed
   across vertices by least squares, holding snapped directions and locked lengths fixed.
5. **Locked lengths**: one locked wall rescales the room uniformly (tracking scale error is
   mostly uniform). Two or more are solved as constraints in step 4.
6. **Validation**: reject self-intersecting polygons; warn on walls shorter than 10 cm.

The closure gap before adjustment is shown to the user as a quality figure ("closed within
3 cm"). A large gap is the best available signal that tracking drifted and the room should be
rescanned.

## 8. Multiple rooms

- Within one AR session, tracking continues as the user walks through a doorway, so the next
  room is captured in the same world frame and lands in roughly the right place.
- Drift between rooms is corrected using the shared doorway. The door is marked in both rooms
  and linked. The second room is moved and rotated so the two openings line up, face to face.
- The gap between the two linked openings along the door's axis is the real wall thickness at
  that doorway, and is used for that wall instead of the default.
- If a project is resumed in a new session, the world frame is gone. Rooms are then placed by a
  linked doorway, or by dragging in the plan view.
- Loops (room A to B to C back to A) can disagree. v1 aligns rooms in scan order as a tree and
  reports the leftover mismatch; it does not do global optimisation.

## 9. Mesh generation

Two export modes:

- **Solid** (default): walls have thickness, so the model works for exterior views, sections
  and boolean work in Blender.
- **Shell**: interior surfaces only, single-sided. Lightest, good for interior renders.

Rules:

- **Walls**: a wall face with rectangular openings is cut into quads on the grid formed by the
  opening edges. No general triangulator needed, and the result is clean quads-as-triangle-pairs
  that Blender's "Tris to Quads" restores exactly.
- **Thickness** (solid mode): the room polygon is offset outward; corners are mitred. Openings
  get reveal faces through the wall depth. Each wall is its own closed solid.
- **Shared walls** (M4, not built): for now every room gets its own walls, `wallThickness`
  thick. Two rooms placed twice that distance apart therefore meet back to back, as two leaves
  of one wall. Merging them into a single body is M4 work.
- **Floor and ceiling**: ear-clipping triangulation of the room polygon.
- **Normals**: flat, facing into the room for shell mode and outward from the solid for solid
  mode.
- **Materials**: every object has its own material, named after it, so each wall, floor and
  ceiling can be coloured independently straight after import. A solid wall has two slots:
  the room-side face (`LivingRoom_Wall_03`) and everything else (`LivingRoom_Wall_03_Body`).
- **UVs**: every face is mapped flat at true scale, one UV unit per metre, upright on vertical
  faces and never mirrored. On a room-side wall face, u is the distance from the wall's start
  corner and v is the height above the floor. No image textures are exported.

## 10. Export and transfer

### GLB

- glTF 2.0 binary, metres, Y up, right-handed. Blender's importer converts to Z up, so the model
  arrives upright and at 1:1 scale with no settings to change.
- Node tree: `Project > Room > Wall_01 ... Wall_n, Floor, Ceiling`. Names carry the room name,
  for example `LivingRoom_Wall_03`.
- The project origin is the first corner of the first room at floor level.
- The plan JSON is embedded in the root node's `extras`, so a later Blender add-on can rebuild
  editable walls from the same file.

### Other formats

- OBJ as a fallback (trivial once the mesh exists).
- The project JSON itself, for backup and for the add-on.
- Not in v1: DXF/SVG 2D plan, USD, IFC.

### Transfer

`ACTION_SEND` through a `FileProvider`. That covers Quick Share to a Windows PC, Google Drive,
email and USB file copy with no code beyond the intent. A local Wi-Fi download page is a possible
later addition if the share sheet proves clumsy.

## 11. Accuracy

| Source of error | Typical size | Mitigation |
|---|---|---|
| ARCore scale and drift in one room | 1 to 2 percent | Locked wall length rescales the room. |
| Aiming error at a far corner | 1 to 5 cm | Distance and angle warning; step closer. |
| Floor plane tilt or offset | under 1 cm | Use the plane after it has stabilised; re-fit at close. |
| Walls not truly square | real, not error | "Square corners" is optional per room. |
| Drift between rooms | 5 to 20 cm over a house | Doorway alignment. |

Expected result: within a few centimetres per wall in a single room without correction, and
within about a centimetre after locking one measured wall in a regular room. These figures are
estimates from how ARCore generally behaves and must be confirmed on real devices in M1 before
any accuracy claim is made in the app.

## 12. Testing

- **`core` unit tests (JVM)**: geometry, solver and mesh against hand-built rooms (rectangle,
  L-shape, non-square, with openings). Property checks: closed polygon, watertight solid mesh,
  consistent winding, wall lengths match the plan.
- **Synthetic capture tests**: generate taps from a known room, add noise and drift of the
  size in section 11, assert the solved plan is within tolerance.
- **Export round trip**: load exported GLBs in headless Blender, check object count, names,
  bounding box and scale.
- **Recorded sessions**: ARCore can record and play back a session, so capture code can be
  replayed against fixed input without walking the room each time.
- **Field test**: three real rooms measured with a tape or laser, compared wall by wall.

Everything above the last two lines runs without a phone.

## 13. Milestones

| | Deliverable | Verifiable without a phone |
|---|---|---|
| M0 (done) | `core`: model, solver, mesh, GLB writer, tests. A CLI that turns a plan JSON into a GLB. | Yes |
| M1 | App shell, AR session, floor detection, corner taps, room closing, AR overlay. | No |
| M2 | Ceiling height, openings, wall mode for hidden corners. | No |
| M3 | Plan review screen, locked lengths, project save and load, export and share. | Partly |
| M4 | Multiple rooms and doorway alignment. | Solver yes, capture no |
| M5 | Blender add-on that rebuilds editable walls from the embedded plan. | Yes |

M0 comes first on purpose: it proves the export in Blender before any AR work, and it is the
part that can be fully built and tested in a cloud session. M1 onward needs builds installed on
a real device.

Later candidates: depth-assisted automatic wall proposals, ceiling-corner capture, sloped
ceilings, multiple storeys, DXF export.

## 14. Risks

| Risk | Impact | Response |
|---|---|---|
| Guided capture is too fiddly in cluttered rooms | Core flow fails | Wall mode in v1; test in a furnished room in M2 before going further. |
| Accuracy is worse than estimated on mid-range phones | Output not trustworthy | Closure figure shown to the user; locked lengths; measure in M1. |
| Tracking loss mid-room (blank walls, low light) | Lost work | Taps are stored as they are made; a room can be resumed while anchors survive, otherwise rescanned alone without losing the project. |
| Solid-wall meshing across shared walls gets complicated | M4 slips | Shell mode ships first; solid mode per room, shared-wall merge last. |
| SceneView API churn | Rework in `app/ar` | Keep rendering behind a small interface; `core` is unaffected. |

## 15. Repository notes

- This lives in `apps/room-scanner/` in the arcade monorepo for now. It shares nothing with the
  games and can be moved to its own repository later with history
  (`git subtree split` or `git filter-repo`).
- GitHub Pages serves `main` as-is, so files under `apps/` would be reachable as static files
  on the arcade site. That is harmless for source, but build outputs and signing keys must be
  git-ignored.
- The arcade's rules in `CLAUDE.md` (single-file HTML, no libraries, pixel-lint) apply to
  `games/` only.

## 16. Open questions

1. **Name.** "Room Scanner" is a placeholder and collides with existing apps.
2. **Wall thickness.** Is a single default (10 cm interior) plus doorway-derived values enough,
   or should exterior walls have their own default?
3. **Units.** Metric only at first, or imperial display from the start?
4. **Test device.** Which phone will this be developed against? It decides whether depth is
   available and sets the accuracy baseline.
5. **Blender workflow.** Is a plain mesh enough, or is the M5 add-on (editable walls) important
   enough to move earlier?
