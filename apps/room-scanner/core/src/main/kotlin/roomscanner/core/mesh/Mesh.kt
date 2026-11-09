package roomscanner.core.mesh

import roomscanner.core.geometry.Vec3

enum class Category { WALL, FLOOR, CEILING }

/** One exported object. Triangles, flat-shaded: vertices are not shared between faces. */
class MeshPart(
    val name: String,
    val category: Category,
    /** x, y, z per vertex, metres. */
    val positions: FloatArray,
    val normals: FloatArray,
    val indices: IntArray,
) {
    val vertexCount: Int get() = positions.size / 3
    val triangleCount: Int get() = indices.size / 3
}

class RoomMesh(val name: String, val parts: List<MeshPart>)

class ProjectMesh(val name: String, val rooms: List<RoomMesh>, val warnings: List<String>)

internal class MeshBuilder(val name: String, val category: Category) {
    private val pos = ArrayList<Float>()
    private val nrm = ArrayList<Float>()
    private val idx = ArrayList<Int>()

    /** Adds a triangle wound so that its face normal is on the same side as [facing]. */
    fun tri(a: Vec3, b: Vec3, c: Vec3, facing: Vec3) {
        var n = (b - a).cross(c - a)
        if (n.length() < 1e-12) return
        val flip = n.dot(facing) < 0
        if (flip) n = n * -1.0
        n = n.normalized()
        val base = pos.size / 3
        for (p in if (flip) listOf(a, c, b) else listOf(a, b, c)) {
            pos += p.x.toFloat(); pos += p.y.toFloat(); pos += p.z.toFloat()
            nrm += n.x.toFloat(); nrm += n.y.toFloat(); nrm += n.z.toFloat()
        }
        idx += base; idx += base + 1; idx += base + 2
    }

    /** Adds a planar quad given its corners in order around the perimeter. */
    fun quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, facing: Vec3) {
        var n = (b - a).cross(c - a)
        if (n.length() < 1e-12) n = (c - a).cross(d - a)
        if (n.length() < 1e-12) return
        val flip = n.dot(facing) < 0
        if (flip) n = n * -1.0
        n = n.normalized()
        val base = pos.size / 3
        for (p in if (flip) listOf(a, d, c, b) else listOf(a, b, c, d)) {
            pos += p.x.toFloat(); pos += p.y.toFloat(); pos += p.z.toFloat()
            nrm += n.x.toFloat(); nrm += n.y.toFloat(); nrm += n.z.toFloat()
        }
        idx += base; idx += base + 1; idx += base + 2
        idx += base; idx += base + 2; idx += base + 3
    }

    val isEmpty: Boolean get() = idx.isEmpty()

    fun build() = MeshPart(name, category, pos.toFloatArray(), nrm.toFloatArray(), idx.toIntArray())
}
