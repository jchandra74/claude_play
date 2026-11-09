"""Imports a room-scanner GLB into Blender and checks that it arrived intact.

Run with Blender's Python module (`pip install bpy`) or inside Blender:

    python3 tools/blender_check.py model.glb [--solid] [--render preview.png]

Checks: the model is upright and at real-world scale, every object kept its name, the plan
is attached, and (with --solid) every wall is a closed manifold once its vertices are merged.
Exits non-zero on any failure.
"""
import math
import sys

import bpy  # must come first: the pip build only exposes bmesh and mathutils after it
import bmesh
from mathutils import Vector


def main():
    args = sys.argv[1:]
    if "--" in args:
        args = args[args.index("--") + 1:]
    path = args[0]
    solid = "--solid" in args
    render = args[args.index("--render") + 1] if "--render" in args else None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)

    failures = []
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    roots = [o for o in bpy.data.objects if o.parent is None]
    if len(roots) != 1:
        failures.append(f"expected one root object, found {len(roots)}")
    plan = roots[0].get("roomScannerPlan") if roots else None
    if plan is None:
        failures.append("the plan is not attached to the root object")
        plan = {}
    else:
        plan = plan.to_dict()

    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    size = hi - lo
    print(f"{len(meshes)} mesh objects, size {size.x:.3f} x {size.y:.3f} x {size.z:.3f} m (x, y, up)")

    rooms = plan.get("rooms", [])
    if rooms:
        tallest = max(r["height"] for r in rooms)
        if abs(size.z - tallest) > 1e-3:
            failures.append(f"model is {size.z:.3f} m tall, the plan says {tallest}: wrong scale or not upright")
        if abs(lo.z) > 1e-3:
            failures.append(f"floor is at z = {lo.z:.3f}, expected 0")
        expected = sum(len(r["vertices"]) + 2 for r in rooms)
        if len(meshes) != expected:
            failures.append(f"expected {expected} mesh objects (walls + floor + ceiling per room), found {len(meshes)}")

    for o in meshes:
        kind = o.name.rsplit("_", 2)
        if not (o.name.endswith("_Floor") or o.name.endswith("_Ceiling") or (len(kind) == 3 and kind[1] == "Wall")):
            failures.append(f"unexpected object name: {o.name}")
        if o.parent is None or o.parent.parent is None:
            failures.append(f"{o.name} is not under project > room")
        if solid and "_Wall_" in o.name:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bad = [e for e in bm.edges if not e.is_manifold]
            volume = bm.calc_volume(signed=True)
            if bad:
                failures.append(f"{o.name}: {len(bad)} non-manifold edges")
            if volume <= 0:
                failures.append(f"{o.name}: volume {volume:.4f}, faces point inward")
            bm.free()

    if render:
        render_preview(render, lo, hi)

    for f in failures:
        print("FAIL:", f)
    print("OK" if not failures else f"{len(failures)} problem(s)")
    sys.exit(1 if failures else 0)


def render_preview(path, lo, hi):
    """A cutaway view from above: ceilings hidden so the rooms are visible."""
    scene = bpy.context.scene
    for o in bpy.data.objects:
        if o.name.endswith("_Ceiling"):
            o.hide_render = True
    centre = (lo + hi) / 2
    span = max(hi.x - lo.x, hi.y - lo.y)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(cam)
    cam.location = centre + Vector((-span * 0.75, -span * 1.05, span * 1.15))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.device = "CPU"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
