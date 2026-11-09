package roomscanner.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import kotlin.math.cos
import kotlin.math.sin

@Serializable
enum class OpeningType {
    @SerialName("door") DOOR,
    @SerialName("window") WINDOW,
}

@Serializable
enum class ExportMode {
    /** Walls are closed solids with thickness. */
    @SerialName("solid") SOLID,

    /** Interior surfaces only. */
    @SerialName("shell") SHELL,
}

/** Where a room's own frame sits in the project frame: `project = rotate(local, yaw) + (x, z)`. */
@Serializable
data class Pose2(val x: Double = 0.0, val z: Double = 0.0, /** Radians, in the (x, z) plan plane. */ val yaw: Double = 0.0) {
    fun rotate(v: Vec2): Vec2 {
        val c = cos(yaw)
        val s = sin(yaw)
        return Vec2(v.x * c - v.z * s, v.x * s + v.z * c)
    }

    fun apply(p: Vec2): Vec2 = rotate(p) + Vec2(x, z)
}

/** A rectangular hole in a wall. All lengths in metres. */
@Serializable
data class Opening(
    val id: String,
    val type: OpeningType,
    /** Distance from the wall's start vertex to the near edge of the opening, along the wall. */
    val offset: Double,
    /** Height of the bottom edge above the floor. Zero for doors. */
    val sill: Double = 0.0,
    val width: Double,
    val height: Double,
    /** The same id on the matching opening in the neighbouring room. */
    val linkId: String? = null,
)

@Serializable
data class Wall(
    val id: String,
    /** A length the user measured and typed in, if any. */
    val lockedLength: Double? = null,
    val openings: List<Opening> = emptyList(),
)

/**
 * One room: a polygon on the floor plus a ceiling height.
 * Wall `i` runs from `vertices[i]` to `vertices[(i + 1) % n]`.
 */
@Serializable
data class Room(
    val id: String,
    val name: String,
    val height: Double,
    val origin: Pose2 = Pose2(),
    val vertices: List<Vec2>,
    val walls: List<Wall> = emptyList(),
) {
    fun wallStart(i: Int): Vec2 = vertices[i]
    fun wallEnd(i: Int): Vec2 = vertices[(i + 1) % vertices.size]
    fun wallLength(i: Int): Double = wallStart(i).distanceTo(wallEnd(i))
    fun toProject(p: Vec2): Vec2 = origin.apply(p)

    /**
     * The canonical form everything downstream expects: one [Wall] per edge and positive winding.
     * Reversing the winding reverses each wall, so opening offsets are re-measured from the new
     * start vertex.
     */
    fun normalized(): Room {
        val n = vertices.size
        val filled = if (walls.isEmpty()) List(n) { Wall(id = "w${it + 1}") } else walls
        require(filled.size == n) { "room '$name': ${filled.size} walls for $n vertices" }
        if (Polygon.signedArea(vertices) >= 0) return copy(walls = filled)
        val newVertices = List(n) { j -> vertices[(n - j) % n] }
        val newWalls = List(n) { j ->
            val old = n - 1 - j
            val len = wallLength(old)
            filled[old].copy(openings = filled[old].openings.map { it.copy(offset = len - it.offset - it.width) })
        }
        return copy(vertices = newVertices, walls = newWalls)
    }

    /** Problems that make the room impossible to mesh. Empty means usable. */
    fun validate(): List<String> {
        val errors = ArrayList<String>()
        if (vertices.size < 3) errors += "room '$name' has fewer than 3 corners"
        if (walls.isNotEmpty() && walls.size != vertices.size) errors += "room '$name' has ${walls.size} walls for ${vertices.size} corners"
        if (height <= 0) errors += "room '$name' has no ceiling height"
        if (vertices.size >= 3 && !Polygon.isSimple(vertices)) errors += "room '$name' has walls that cross each other"
        return errors
    }
}

@Serializable
data class Settings(
    val wallThickness: Double = 0.10,
    val exportMode: ExportMode = ExportMode.SOLID,
)

@Serializable
data class Project(
    val version: Int = 1,
    val name: String,
    /** Display preference only. Stored lengths are always metres. */
    val units: String = "metric",
    val rooms: List<Room> = emptyList(),
    val settings: Settings = Settings(),
) {
    fun normalized(): Project = copy(rooms = rooms.map { it.normalized() })
    fun validate(): List<String> = rooms.flatMap { it.validate() }
}
