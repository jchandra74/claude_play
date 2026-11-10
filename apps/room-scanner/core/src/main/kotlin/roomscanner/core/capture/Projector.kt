package roomscanner.core.capture

import roomscanner.core.geometry.Mat4
import roomscanner.core.geometry.Vec3

/** A point on screen, in pixels from the top-left corner. */
data class ScreenPoint(val x: Float, val y: Float)

data class ScreenSegment(val a: ScreenPoint, val b: ScreenPoint)

/**
 * Maps between world space and the screen for one camera frame.
 *
 * @param viewProjection projection * view, as ARCore reports them for the frame.
 */
class Projector(private val viewProjection: Mat4, private val width: Int, private val height: Int) {
    private val inverse: Mat4? = viewProjection.inverse()

    /** The screen position of a world point, or null if it is behind the camera. */
    fun project(p: Vec3): ScreenPoint? {
        val c = viewProjection.transform(p.x, p.y, p.z, 1.0)
        return if (c[3] < NEAR_W) null else toScreen(c)
    }

    /** The visible part of a world-space line, clipped where it passes behind the camera. */
    fun project(a: Vec3, b: Vec3): ScreenSegment? {
        var ca = viewProjection.transform(a.x, a.y, a.z, 1.0)
        var cb = viewProjection.transform(b.x, b.y, b.z, 1.0)
        if (ca[3] < NEAR_W && cb[3] < NEAR_W) return null
        if (ca[3] < NEAR_W) ca = clip(ca, cb)
        if (cb[3] < NEAR_W) cb = clip(cb, ca)
        return ScreenSegment(toScreen(ca), toScreen(cb))
    }

    /** The line of sight through a screen position. Defaults to the centre, where the reticle is. */
    fun ray(x: Float = width / 2f, y: Float = height / 2f): Ray? {
        val inv = inverse ?: return null
        val nx = 2.0 * x / width - 1
        val ny = 1 - 2.0 * y / height
        val near = inv.transform(nx, ny, -1.0, 1.0)
        val far = inv.transform(nx, ny, 1.0, 1.0)
        if (near[3] == 0.0 || far[3] == 0.0) return null
        val o = Vec3(near[0] / near[3], near[1] / near[3], near[2] / near[3])
        val f = Vec3(far[0] / far[3], far[1] / far[3], far[2] / far[3])
        val d = f - o
        return if (d.length() < 1e-9) null else Ray(o, d.normalized())
    }

    /** Moves the point [behind] along the line towards [front] until it is just in front of the camera. */
    private fun clip(behind: DoubleArray, front: DoubleArray): DoubleArray {
        val t = (NEAR_W - behind[3]) / (front[3] - behind[3])
        return DoubleArray(4) { behind[it] + (front[it] - behind[it]) * t }
    }

    private fun toScreen(c: DoubleArray) = ScreenPoint(
        ((c[0] / c[3] + 1) / 2 * width).toFloat(),
        ((1 - c[1] / c[3]) / 2 * height).toFloat(),
    )

    private companion object {
        const val NEAR_W = 0.02
    }
}
