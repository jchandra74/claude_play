package roomscanner.core.capture

import roomscanner.core.geometry.Vec2
import roomscanner.core.geometry.Vec3
import roomscanner.core.geometry.at

/** How an overlay line should be drawn. The app maps these to colours and widths. */
enum class LineStyle { WALL, GUIDE, GUIDE_WARN, CLOSE, HIGHLIGHT, OPENING, PENDING }

class OverlayLine(val a: Vec3, val b: Vec3, val style: LineStyle)

/** The 3D guides to draw over the camera image for the current state of a capture. */
object Overlay {
    private const val POST = 0.12

    fun lines(capture: RoomCapture, aim: Aim?): List<OverlayLine> {
        val out = ArrayList<OverlayLine>()
        val y0 = capture.floorY
        val outline = capture.outline

        if (outline == null) {
            val c = capture.corners
            for (i in c.indices) {
                out += OverlayLine(c[i].at(y0), c[i].at(y0 + POST), LineStyle.WALL)
                if (i > 0) out += OverlayLine(c[i - 1].at(y0), c[i].at(y0), LineStyle.WALL)
            }
            val p = aim?.floorPoint
            if (p != null) {
                val style = when {
                    aim.wouldClose -> LineStyle.CLOSE
                    aim.reliable -> LineStyle.GUIDE
                    else -> LineStyle.GUIDE_WARN
                }
                if (c.isNotEmpty()) out += OverlayLine(c.last().at(y0), p.at(y0), style)
                out += OverlayLine(p.at(y0), p.at(y0 + POST), style)
            }
            return out
        }

        val n = outline.size
        val h = capture.height
        val top = y0 + (h ?: aim?.height ?: 0.0)
        for (i in 0 until n) {
            val a = outline[i]
            val b = outline[(i + 1) % n]
            val style = if (aim?.wallIndex == i) LineStyle.HIGHLIGHT else LineStyle.WALL
            out += OverlayLine(a.at(y0), b.at(y0), style)
            if (top > y0) {
                out += OverlayLine(a.at(top), b.at(top), if (h == null) LineStyle.GUIDE else style)
                out += OverlayLine(a.at(y0), a.at(top), if (h == null) LineStyle.GUIDE else LineStyle.WALL)
            } else {
                out += OverlayLine(a.at(y0), a.at(y0 + POST), LineStyle.WALL)
            }
        }

        fun onWall(i: Int, along: Double, y: Double): Vec3 {
            val a = outline[i]
            val d = (outline[(i + 1) % n] - a).normalized()
            return (a + d * along).at(y)
        }
        fun rect(i: Int, u0: Double, u1: Double, v0: Double, v1: Double, style: LineStyle) {
            val p = listOf(onWall(i, u0, v0), onWall(i, u1, v0), onWall(i, u1, v1), onWall(i, u0, v1))
            for (k in 0..3) out += OverlayLine(p[k], p[(k + 1) % 4], style)
        }
        for (o in capture.openings) {
            rect(o.wallIndex, o.opening.offset, o.opening.offset + o.opening.width, y0 + o.opening.sill, y0 + o.opening.sill + o.opening.height, LineStyle.OPENING)
        }
        val pending = capture.pendingOpening
        val hit = aim?.wallHit
        if (pending != null && hit != null && aim.wallIndex == pending.first) {
            rect(pending.first, pending.second.along, hit.along, pending.second.y, hit.y, LineStyle.PENDING)
        }
        return out
    }

    /** Where to draw the reticle's target marker, if the aim lands on something. */
    fun target(capture: RoomCapture, aim: Aim?): Vec3? {
        aim ?: return null
        aim.floorPoint?.let { return it.at(capture.floorY) }
        val outline = capture.outline ?: return null
        val i = aim.wallIndex ?: return null
        val hit = aim.wallHit ?: return null
        val a: Vec2 = outline[i]
        val d = (outline[(i + 1) % outline.size] - a).normalized()
        return (a + d * hit.along).at(hit.y)
    }
}
