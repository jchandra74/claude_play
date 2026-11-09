package roomscanner.core.geometry

import kotlinx.serialization.Serializable
import kotlin.math.sqrt

/**
 * A point or direction on the floor plan, in metres.
 *
 * Plan axes are the world X and Z axes of a right-handed, Y-up frame (the same convention as
 * ARCore and glTF), so plan coordinates go into the exported model unchanged.
 */
@Serializable
data class Vec2(val x: Double, val z: Double) {
    operator fun plus(o: Vec2) = Vec2(x + o.x, z + o.z)
    operator fun minus(o: Vec2) = Vec2(x - o.x, z - o.z)
    operator fun times(s: Double) = Vec2(x * s, z * s)
    operator fun unaryMinus() = Vec2(-x, -z)
    fun dot(o: Vec2) = x * o.x + z * o.z

    /** 2D cross product in the (x, z) plane. */
    fun cross(o: Vec2) = x * o.z - z * o.x
    fun length() = sqrt(x * x + z * z)
    fun distanceTo(o: Vec2) = (this - o).length()
    fun normalized(): Vec2 {
        val l = length()
        require(l > 1e-12) { "cannot normalise a zero vector" }
        return Vec2(x / l, z / l)
    }

    /** This vector turned a quarter turn towards the interior side of a positively wound polygon. */
    fun perpLeft() = Vec2(-z, x)
}

data class Vec3(val x: Double, val y: Double, val z: Double) {
    operator fun plus(o: Vec3) = Vec3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    operator fun times(s: Double) = Vec3(x * s, y * s, z * s)
    fun dot(o: Vec3) = x * o.x + y * o.y + z * o.z
    fun cross(o: Vec3) = Vec3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun length() = sqrt(x * x + y * y + z * z)
    fun normalized(): Vec3 {
        val l = length()
        require(l > 1e-12) { "cannot normalise a zero vector" }
        return Vec3(x / l, y / l, z / l)
    }

    companion object {
        val UP = Vec3(0.0, 1.0, 0.0)
        val DOWN = Vec3(0.0, -1.0, 0.0)
    }
}

fun Vec2.at(y: Double) = Vec3(x, y, z)
