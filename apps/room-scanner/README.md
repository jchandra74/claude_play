# Room Scanner

An Android app (in progress) that captures the structure of a room with the phone camera and
exports a clean 3D model for Blender. The design is in [`DESIGN.md`](DESIGN.md).

![The sample plan, exported and rendered in Blender with the ceilings hidden](docs/sample-solid.png)

## Status

| Milestone | State |
|---|---|
| M0: `core` library and plan-to-GLB tool | Done |
| M1 to M4: the Android app (AR capture, review, multi-room) | Not started |
| M5: Blender add-on for editable walls | Not started |

There is no app to install yet. What exists is the part that does not need a phone: the plan
model, the solver that cleans up tapped corners, the mesher, and the GLB writer.

## Try it

Needs JDK 17 or newer.

```
./gradlew :core:test
./gradlew :core:run --args="../samples/two-rooms.json -o ../out/flat.glb"
```

Then in Blender: File > Import > glTF 2.0, and pick `out/flat.glb`. It arrives upright, at 1:1
scale in metres, with one named object per wall, floor and ceiling under a parent per room.

Options: `--mode shell` for interior surfaces only, `--thickness 0.15`, `--obj` to also write
an OBJ. Plan files are JSON; `samples/two-rooms.json` shows the format.

To check an export against a real Blender without opening it:

```
pip install bpy
python3 tools/blender_check.py out/flat.glb --solid --render out/preview.png
```

## Layout

```
core/                 Pure Kotlin, no Android dependencies
  model/              Project, Room, Wall, Opening
  geometry/           vectors, polygons, triangulation
  capture/            the maths behind each tap (ray against floor or wall)
  solve/              corner clean-up, measured lengths, joining rooms at a doorway
  mesh/               plan to triangles
  export/             GLB, OBJ, plan JSON
  cli/                the plan-to-GLB tool
samples/              example plan
tools/blender_check.py  imports a GLB into Blender and verifies it
```

## Known limits

- Every room gets its own walls. Where two rooms share a wall you get two leaves back to back
  rather than one body (see DESIGN.md section 9).
- Floors and ceilings are flat surfaces, not slabs.
- Flat ceilings, straight walls and rectangular openings only.
- The accuracy figures in the design are estimates. The solver is tested against simulated
  scans, not real ones; that needs the app on a phone.
