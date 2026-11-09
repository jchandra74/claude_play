package roomscanner.core.capture

import roomscanner.core.geometry.Vec2
import roomscanner.core.geometry.Vec3
import roomscanner.core.model.Opening
import roomscanner.core.model.OpeningType
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin

/** The line of sight through the reticle: camera position and view direction, in AR world space. */
data class Ray(val origin: Vec3, val dir: Vec3)

/** Where a ray meets a wall's plane. */
data class WallHit(
    /** Distance along the wall from its start vertex. May fall outside the wall. */
    val along: Double,
    /** World height of the hit. */
    val y: Double,
    val distance: Double,
)

data class FloorTap(
    val point: Vec2,
    val distance: Double,
    /** Angle between the line of sight and the floor. Small angles magnify aiming error. */
    val grazingDeg: Double,
) {
    /** The capture screen warns when this is false. */
    val reliable: Boolean get() = distance <= 4.0 && grazingDeg >= 15.0
}

/**
 * The geometry behind each kind of tap. Taps intersect the reticle ray with a known plane, so
 * they need no visual feature at the target and work on blank walls.
 */
object CaptureMath {

    /** A corner tap: where the reticle ray meets the floor. Null when aiming at or above the horizon. */
    fun floorTap(ray: Ray, floorY: Double): FloorTap? {
        val d = ray.dir.normalized()
        if (d.y > -1e-6) return null
        val t = (floorY - ray.origin.y) / d.y
        if (t <= 0) return null
        val p = ray.origin + d * t
        return FloorTap(Vec2(p.x, p.z), t, asin(-d.y) * 180 / PI)
    }

    /** Where the reticle ray meets the vertical plane through the wall from [a] to [b]. */
    fun wallHit(ray: Ray, a: Vec2, b: Vec2): WallHit? {
        val d = ray.dir.normalized()
        val w = (b - a).normalized()
        val n = w.perpLeft()
        val denom = d.x * n.x + d.z * n.z
        if (abs(denom) < 1e-6) return null
        val t = ((a.x - ray.origin.x) * n.x + (a.z - ray.origin.z) * n.z) / denom
        if (t <= 0) return null
        val p = ray.origin + d * t
        return WallHit((Vec2(p.x, p.z) - a).dot(w), p.y, t)
    }

    /** Ceiling height from one tap on the edge where a wall meets the ceiling. */
    fun ceilingHeight(ray: Ray, a: Vec2, b: Vec2, floorY: Double): Double? {
        val h = wallHit(ray, a, b) ?: return null
        val height = h.y - floorY
        return if (height > 0) height else null
    }

    /**
     * An opening from taps on two diagonally opposite corners, clamped to the wall.
     * Doors are extended down to the floor.
     */
    fun openingFromHits(
        id: String, type: OpeningType, h1: WallHit, h2: WallHit,
        wallLength: Double, roomHeight: Double, floorY: Double,
    ): Opening? {
        val u0 = minOf(h1.along, h2.along).coerceIn(0.0, wallLength)
        val u1 = maxOf(h1.along, h2.along).coerceIn(0.0, wallLength)
        val v0 = if (type == OpeningType.DOOR) 0.0 else (minOf(h1.y, h2.y) - floorY).coerceIn(0.0, roomHeight)
        val v1 = (maxOf(h1.y, h2.y) - floorY).coerceIn(0.0, roomHeight)
        if (u1 - u0 < 0.05 || v1 - v0 < 0.05) return null
        return Opening(id = id, type = type, offset = u0, sill = v0, width = u1 - u0, height = v1 - v0)
    }
}
