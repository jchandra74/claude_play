package roomscanner.core.mesh

import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import roomscanner.core.geometry.Vec3
import roomscanner.core.geometry.at
import roomscanner.core.model.ExportMode
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Project
import roomscanner.core.model.Room

/**
 * Builds the 3D model from the plan.
 *
 * Each wall is its own object. In solid mode a wall is a closed solid: its room-side face, its
 * outer face [thickness] further out, top, bottom, the mitred ends where it meets its
 * neighbours, and the reveals of its openings. In shell mode only the room-side face exists.
 * Floors and ceilings are flat polygons in both modes.
 *
 * Every object has its own material, named after it, so each can be coloured on its own. A solid
 * wall has two: the room-side face, and "_Body" for everything else.
 */
object RoomMesher {

    fun mesh(
        input: Project,
        mode: ExportMode = input.settings.exportMode,
        thickness: Double = input.settings.wallThickness,
        /** Move the model so the first corner of the first room is at the origin. */
        recenter: Boolean = true,
    ): ProjectMesh {
        val project = input.normalized()
        val problems = project.validate()
        require(problems.isEmpty()) { problems.joinToString("; ") }
        require(mode == ExportMode.SHELL || thickness > 0) { "solid walls need a thickness" }

        val shift = if (recenter && project.rooms.isNotEmpty()) -project.rooms[0].toProject(project.rooms[0].vertices[0]) else Vec2(0.0, 0.0)
        val warnings = ArrayList<String>()
        val used = HashSet<String>()
        val rooms = project.rooms.map { room ->
            var base = objectName(room.name)
            if (!used.add(base)) {
                var k = 2
                while (!used.add("${base}_$k")) k++
                base = "${base}_$k"
            }
            meshRoom(room, base, mode, thickness, shift, warnings)
        }
        return ProjectMesh(project.name, rooms, warnings)
    }

    private fun meshRoom(room: Room, base: String, mode: ExportMode, t: Double, shift: Vec2, warnings: MutableList<String>): RoomMesh {
        val v = room.vertices.map { room.toProject(it) + shift }
        val n = v.size
        val h = room.height
        val solid = mode == ExportMode.SOLID
        val outer = if (solid) offsetOutward(v, t) else v

        val floor = MeshBuilder("${base}_Floor", Category.FLOOR)
        val ceiling = MeshBuilder("${base}_Ceiling", Category.CEILING)
        for (tri in Polygon.triangulate(v)) {
            floor.tri(v[tri[0]].at(0.0), v[tri[1]].at(0.0), v[tri[2]].at(0.0), Vec3.UP)
            ceiling.tri(v[tri[0]].at(h), v[tri[1]].at(h), v[tri[2]].at(h), Vec3.DOWN)
        }

        val parts = ArrayList<MeshPart>()
        for (i in 0 until n) {
            val wallName = "${base}_Wall_${"%02d".format(i + 1)}"
            // UVs on the room-side face run from the wall's start corner at floor level.
            val wall = MeshBuilder(wallName, Category.WALL, listOf(wallName, wallName + BODY_SUFFIX), v[i].at(0.0))
            meshWall(room, i, v[i], v[(i + 1) % n], outer[i], outer[(i + 1) % n], h, t, solid, wall, floor, ceiling, warnings)
            if (!wall.isEmpty) parts += wall.build()
        }
        parts += floor.build()
        parts += ceiling.build()
        return RoomMesh(base, parts)
    }

    private class Hole(val u0: Double, val u1: Double, val v0: Double, val v1: Double)

    private fun meshWall(
        room: Room, i: Int, a: Vec2, b: Vec2, oa: Vec2, ob: Vec2, h: Double, t: Double, solid: Boolean,
        wall: MeshBuilder, floor: MeshBuilder, ceiling: MeshBuilder, warnings: MutableList<String>,
    ) {
        val len = a.distanceTo(b)
        if (len < 1e-6) return
        val d = (b - a) * (1 / len)
        val inward = d.perpLeft()
        val out = -inward
        val d3 = d.at(0.0)
        val in3 = inward.at(0.0)
        val out3 = out.at(0.0)

        // Openings must stay clear of the mitred ends, on both faces of the wall.
        var uMin = MARGIN
        var uMax = len - MARGIN
        if (solid) {
            uMin = maxOf(uMin, (oa - a).dot(d) + MARGIN)
            uMax = minOf(uMax, (ob - a).dot(d) - MARGIN)
        }
        val holes = ArrayList<Hole>()
        for (o in room.walls[i].openings) {
            val u0 = o.offset.coerceIn(uMin, uMax)
            val u1 = (o.offset + o.width).coerceIn(uMin, uMax)
            var v0 = if (o.type == OpeningType.DOOR) 0.0 else o.sill.coerceIn(0.0, h)
            var v1 = (o.sill + o.height).coerceIn(0.0, h)
            if (v0 < MARGIN) v0 = 0.0
            if (h - v1 < MARGIN) v1 = h
            if (u1 - u0 < MIN_OPENING || v1 - v0 < MIN_OPENING) {
                warnings += "${wall.name}: opening '${o.id}' does not fit on the wall and was left out"
                continue
            }
            if (u0 != o.offset || u1 != o.offset + o.width) warnings += "${wall.name}: opening '${o.id}' was trimmed to fit the wall"
            holes += Hole(u0, u1, v0, v1)
        }

        // Cut the wall into a grid along every opening edge; each cell is all wall or all hole.
        val us = breaks(listOf(0.0, len) + holes.flatMap { listOf(it.u0, it.u1) })
        val vs = breaks(listOf(0.0, h) + holes.flatMap { listOf(it.v0, it.v1) })
        val nu = us.size - 1
        val nv = vs.size - 1
        fun open(ci: Int, cj: Int): Boolean {
            val u = (us[ci] + us[ci + 1]) / 2
            val v = (vs[cj] + vs[cj + 1]) / 2
            return holes.any { u > it.u0 && u < it.u1 && v > it.v0 && v < it.v1 }
        }
        fun inner(k: Int, y: Double): Vec3 = (a + d * us[k]).at(y)
        fun outer(k: Int, y: Double): Vec3 = when (k) {
            0 -> oa.at(y)
            nu -> ob.at(y)
            else -> (a + d * us[k] + out * t).at(y)
        }

        for (ci in 0 until nu) for (cj in 0 until nv) {
            val y0 = vs[cj]
            val y1 = vs[cj + 1]
            if (open(ci, cj)) {
                if (solid && cj == 0) floor.quad(inner(ci, 0.0), inner(ci + 1, 0.0), outer(ci + 1, 0.0), outer(ci, 0.0), Vec3.UP)
                if (solid && cj == nv - 1) ceiling.quad(inner(ci, h), inner(ci + 1, h), outer(ci + 1, h), outer(ci, h), Vec3.DOWN)
                continue
            }
            wall.quad(inner(ci, y0), inner(ci + 1, y0), inner(ci + 1, y1), inner(ci, y1), in3)
            if (!solid) continue
            wall.quad(outer(ci, y0), outer(ci + 1, y0), outer(ci + 1, y1), outer(ci, y1), out3, BODY)
            // A side of the cell is on the solid's surface if it is at the wall's edge or borders a hole.
            if (ci == 0 || open(ci - 1, cj)) wall.quad(inner(ci, y0), inner(ci, y1), outer(ci, y1), outer(ci, y0), d3 * -1.0, BODY)
            if (ci == nu - 1 || open(ci + 1, cj)) wall.quad(inner(ci + 1, y0), inner(ci + 1, y1), outer(ci + 1, y1), outer(ci + 1, y0), d3, BODY)
            if (cj == 0 || open(ci, cj - 1)) wall.quad(inner(ci, y0), inner(ci + 1, y0), outer(ci + 1, y0), outer(ci, y0), Vec3.DOWN, BODY)
            if (cj == nv - 1 || open(ci, cj + 1)) wall.quad(inner(ci, y1), inner(ci + 1, y1), outer(ci + 1, y1), outer(ci, y1), Vec3.UP, BODY)
        }
    }

    /** The room polygon pushed outward by [t], with mitred corners. */
    private fun offsetOutward(v: List<Vec2>, t: Double): List<Vec2> {
        val n = v.size
        return List(n) { i ->
            val prev = v[(i + n - 1) % n]
            val next = v[(i + 1) % n]
            val n1 = -(v[i] - prev).normalized().perpLeft()
            val n2 = -(next - v[i]).normalized().perpLeft()
            // Limit the mitre on very sharp corners so it cannot shoot off to infinity.
            val k = maxOf(1 + n1.dot(n2), 0.2)
            v[i] + (n1 + n2) * (t / k)
        }
    }

    private fun breaks(values: List<Double>): List<Double> {
        val out = ArrayList<Double>()
        for (x in values.sorted()) if (out.isEmpty() || x - out.last() > 1e-6) out += x
        return out
    }

    /** "living room 2" becomes "LivingRoom2". */
    internal fun objectName(name: String): String {
        val s = name.split(Regex("[^A-Za-z0-9]+")).filter { it.isNotEmpty() }
            .joinToString("") { it.replaceFirstChar(Char::uppercaseChar) }
        return s.ifEmpty { "Room" }
    }

    const val BODY_SUFFIX = "_Body"
    private const val BODY = 1
    private const val MARGIN = 0.02
    private const val MIN_OPENING = 0.05
}
