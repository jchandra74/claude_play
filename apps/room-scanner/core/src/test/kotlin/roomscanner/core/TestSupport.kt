package roomscanner.core

import roomscanner.core.geometry.Vec2
import roomscanner.core.geometry.Vec3
import roomscanner.core.mesh.MeshPart
import roomscanner.core.model.Opening
import roomscanner.core.model.Project
import roomscanner.core.model.Room
import roomscanner.core.model.Wall
import kotlin.math.roundToLong
import kotlin.test.assertEquals
import kotlin.test.assertTrue

fun rect(w: Double, d: Double) = listOf(Vec2(0.0, 0.0), Vec2(w, 0.0), Vec2(w, d), Vec2(0.0, d))

/** An L: a 5 x 4 block with a 2.5 x 1.5 leg. Area 23.75, perimeter 21. */
val L_SHAPE = listOf(Vec2(0.0, 0.0), Vec2(5.0, 0.0), Vec2(5.0, 4.0), Vec2(2.5, 4.0), Vec2(2.5, 5.5), Vec2(0.0, 5.5))

fun room(vertices: List<Vec2>, height: Double = 2.4, name: String = "Room", openings: Map<Int, List<Opening>> = emptyMap()) =
    Room(id = "r", name = name, height = height, vertices = vertices,
        walls = vertices.indices.map { Wall("w${it + 1}", openings = openings[it] ?: emptyList()) })

fun project(vararg rooms: Room) = Project(name = "Test", rooms = rooms.toList())

fun MeshPart.vertex(i: Int) = Vec3(positions[3 * i].toDouble(), positions[3 * i + 1].toDouble(), positions[3 * i + 2].toDouble())
fun MeshPart.normal(i: Int) = Vec3(normals[3 * i].toDouble(), normals[3 * i + 1].toDouble(), normals[3 * i + 2].toDouble())

fun MeshPart.area(): Double = (0 until triangleCount).sumOf { t ->
    val a = vertex(indices[3 * t]); val b = vertex(indices[3 * t + 1]); val c = vertex(indices[3 * t + 2])
    (b - a).cross(c - a).length() / 2
}

/** Signed volume by the divergence theorem. Positive when faces point outward. */
fun MeshPart.volume(): Double = (0 until triangleCount).sumOf { t ->
    val a = vertex(indices[3 * t]); val b = vertex(indices[3 * t + 1]); val c = vertex(indices[3 * t + 2])
    a.dot(b.cross(c)) / 6
}

/** Every edge must be shared by exactly two triangles that traverse it in opposite directions. */
fun assertClosedSolid(part: MeshPart) {
    fun key(i: Int): String {
        val v = part.vertex(i)
        return "${(v.x * 1e4).roundToLong()},${(v.y * 1e4).roundToLong()},${(v.z * 1e4).roundToLong()}"
    }
    val edges = HashMap<Pair<String, String>, Int>()
    for (t in 0 until part.triangleCount) for (k in 0..2) {
        val e = key(part.indices[3 * t + k]) to key(part.indices[3 * t + (k + 1) % 3])
        edges[e] = (edges[e] ?: 0) + 1
    }
    assertTrue(edges.isNotEmpty(), "${part.name} is empty")
    for ((e, count) in edges) {
        assertEquals(1, count, "${part.name}: edge $e used $count times in the same direction")
        assertEquals(1, edges[e.second to e.first] ?: 0, "${part.name}: edge $e has no matching opposite edge")
    }
}

/** Every stored normal must match its triangle's winding. */
fun assertNormalsMatchWinding(part: MeshPart) {
    for (t in 0 until part.triangleCount) {
        val a = part.vertex(part.indices[3 * t]); val b = part.vertex(part.indices[3 * t + 1]); val c = part.vertex(part.indices[3 * t + 2])
        val face = (b - a).cross(c - a).normalized()
        for (k in 0..2) assertTrue(face.dot(part.normal(part.indices[3 * t + k])) > 0.999, "${part.name}: normal disagrees with winding")
    }
}
