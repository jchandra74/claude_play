package roomscanner.core.mesh

import roomscanner.core.geometry.Vec3
import kotlin.math.abs

enum class Category { WALL, FLOOR, CEILING }

/** The faces of an object that share one material. Becomes a material slot in Blender. */
class Surface(val material: String, val indices: IntArray)

/** One exported object. Triangles, flat-shaded: vertices are not shared between faces. */
class MeshPart(
    val name: String,
    val category: Category,
    /** x, y, z per vertex, metres. */
    val positions: FloatArray,
    val normals: FloatArray,
    /**
     * u, v per vertex, with v pointing up (Blender's convention). One unit is one metre, so a
     * texture that repeats every metre tiles at true scale.
     */
    val uvs: FloatArray,
    val surfaces: List<Surface>,
) {
    /** All triangles, across every surface. */
    val indices: IntArray by lazy { surfaces.flatMap { it.indices.asList() }.toIntArray() }
    val vertexCount: Int get() = positions.size / 3
    val triangleCount: Int get() = indices.size / 3
}

class RoomMesh(val name: String, val parts: List<MeshPart>)

class ProjectMesh(val name: String, val rooms: List<RoomMesh>, val warnings: List<String>)

/**
 * @param surfaceNames the material name of each surface, in slot order.
 * @param uvOrigin the point that maps to UV (0, 0).
 */
internal class MeshBuilder(
    val name: String,
    val category: Category,
    private val surfaceNames: List<String> = listOf(name),
    private val uvOrigin: Vec3 = Vec3(0.0, 0.0, 0.0),
) {
    private val pos = ArrayList<Float>()
    private val nrm = ArrayList<Float>()
    private val uv = ArrayList<Float>()
    private val idx = List(surfaceNames.size) { ArrayList<Int>() }

    /** Adds a triangle wound so that its face normal is on the same side as [facing]. */
    fun tri(a: Vec3, b: Vec3, c: Vec3, facing: Vec3, surface: Int = 0) {
        var n = (b - a).cross(c - a)
        if (n.length() < 1e-12) return
        val flip = n.dot(facing) < 0
        if (flip) n = n * -1.0
        val base = emit(if (flip) listOf(a, c, b) else listOf(a, b, c), n.normalized())
        idx[surface] += listOf(base, base + 1, base + 2)
    }

    /** Adds a planar quad given its corners in order around the perimeter. */
    fun quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, facing: Vec3, surface: Int = 0) {
        var n = (b - a).cross(c - a)
        if (n.length() < 1e-12) n = (c - a).cross(d - a)
        if (n.length() < 1e-12) return
        val flip = n.dot(facing) < 0
        if (flip) n = n * -1.0
        val base = emit(if (flip) listOf(a, d, c, b) else listOf(a, b, c, d), n.normalized())
        idx[surface] += listOf(base, base + 1, base + 2, base, base + 2, base + 3)
    }

    private fun emit(points: List<Vec3>, n: Vec3): Int {
        val base = pos.size / 3
        // Project along the face normal so the texture is undistorted, upright on vertical
        // faces, and never mirrored when seen from the front.
        val horizontal = abs(n.y) > 0.5
        val right = if (horizontal) Vec3(if (n.y > 0) 1.0 else -1.0, 0.0, 0.0) else Vec3.UP.cross(n).normalized()
        val up = if (horizontal) Vec3(0.0, 0.0, -1.0) else Vec3.UP
        for (p in points) {
            pos += p.x.toFloat(); pos += p.y.toFloat(); pos += p.z.toFloat()
            nrm += n.x.toFloat(); nrm += n.y.toFloat(); nrm += n.z.toFloat()
            val q = p - uvOrigin
            uv += q.dot(right).toFloat(); uv += q.dot(up).toFloat()
        }
        return base
    }

    val isEmpty: Boolean get() = idx.all { it.isEmpty() }

    fun build() = MeshPart(
        name, category, pos.toFloatArray(), nrm.toFloatArray(), uv.toFloatArray(),
        surfaceNames.indices.filter { idx[it].isNotEmpty() }.map { Surface(surfaceNames[it], idx[it].toIntArray()) },
    )
}
