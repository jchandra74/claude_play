package roomscanner.core.capture

import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import roomscanner.core.model.Opening
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Room
import roomscanner.core.model.Wall
import roomscanner.core.solve.PlanSolver
import roomscanner.core.solve.SolveOptions
import roomscanner.core.solve.SolveResult
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/** What the next tap will do. */
enum class CaptureStep {
    /** Marking wall-floor corners around the room. */
    CORNERS,

    /** Marking the edge where a wall meets the ceiling. */
    HEIGHT,

    /** Marking doors and windows. Optional; the room is already complete. */
    OPENINGS,
}

/** What the reticle is pointing at right now. Null fields mean "nothing usable". */
data class Aim(
    val step: CaptureStep,
    /** CORNERS: where a tap would put the corner, after snapping. */
    val floorPoint: Vec2? = null,
    /** CORNERS: false when the target is too far or seen at too shallow an angle to trust. */
    val reliable: Boolean = true,
    /** CORNERS: a tap now would close the room onto its first corner. */
    val wouldClose: Boolean = false,
    /** CORNERS: length of the wall a tap would create. */
    val segmentLength: Double? = null,
    /** HEIGHT and OPENINGS: the wall being pointed at. */
    val wallIndex: Int? = null,
    /** HEIGHT and OPENINGS: where on that wall. */
    val wallHit: WallHit? = null,
    /** HEIGHT: the ceiling height a tap would set. */
    val height: Double? = null,
) {
    val valid: Boolean
        get() = when (step) {
            CaptureStep.CORNERS -> floorPoint != null
            CaptureStep.HEIGHT -> height != null
            CaptureStep.OPENINGS -> wallHit != null
        }
}

data class CaptureOptions(
    /** Aiming this close to the first corner closes the room. */
    val closeRadius: Double = 0.25,
    val snapToleranceDeg: Double = 7.0,
    val minCeiling: Double = 1.5,
    val maxCeiling: Double = 6.0,
    val solve: SolveOptions = SolveOptions(),
)

/**
 * The capture of one room, tap by tap. Holds no Android or ARCore types: the app feeds it the
 * reticle's line of sight and draws what it reports.
 *
 * @param floorY world height of the floor, fixed for the whole room.
 */
class RoomCapture(val floorY: Double, private val options: CaptureOptions = CaptureOptions()) {

    class PlacedOpening(val wallIndex: Int, val opening: Opening)

    private val taps = ArrayList<Vec2>()
    private var closing: Vec2? = null
    private val placed = ArrayList<PlacedOpening>()
    private var counter = 0

    var step: CaptureStep = CaptureStep.CORNERS
        private set

    /** Corners tapped so far, while the room is still open. */
    val corners: List<Vec2> get() = taps

    /** The cleaned-up outline, once the room has been closed. Positively wound. */
    var outline: List<Vec2>? = null
        private set

    var solve: SolveResult? = null
        private set

    var height: Double? = null
        private set

    val openings: List<PlacedOpening> get() = placed

    /** The first corner of an opening, waiting for its diagonal partner. */
    var pendingOpening: Pair<Int, WallHit>? = null
        private set

    /** Turn off to mark a wall at any angle to the previous one. */
    var angleSnap: Boolean = true
    var openingType: OpeningType = OpeningType.DOOR

    /** True once the room has an outline and a height, so [toRoom] works. */
    val complete: Boolean get() = outline != null && height != null
    val canUndo: Boolean get() = taps.isNotEmpty()

    fun aim(ray: Ray): Aim = when (step) {
        CaptureStep.CORNERS -> aimCorner(ray)
        CaptureStep.HEIGHT -> {
            val hit = aimWall(ray)
            val h = hit?.second?.let { it.y - floorY }?.takeIf { it in options.minCeiling..options.maxCeiling }
            Aim(step, wallIndex = hit?.first, wallHit = hit?.second, height = h)
        }
        CaptureStep.OPENINGS -> {
            val hit = aimWall(ray)?.takeIf { it.second.y - floorY in 0.0..(height ?: 0.0) + 0.05 }
            Aim(step, wallIndex = hit?.first, wallHit = hit?.second)
        }
    }

    /**
     * Acts on a tap. Returns null on success, or a short message saying why nothing happened.
     */
    fun tap(ray: Ray): String? {
        val a = aim(ray)
        when (step) {
            CaptureStep.CORNERS -> {
                val p = a.floorPoint ?: return "Aim at the floor"
                if (a.wouldClose) return close(CaptureMath.floorTap(ray, floorY)!!.point)
                if (taps.isNotEmpty() && p.distanceTo(taps.last()) < 0.05) return "Too close to the last corner"
                taps += p
            }
            CaptureStep.HEIGHT -> {
                height = a.height ?: return "Aim at the edge where a wall meets the ceiling"
                step = CaptureStep.OPENINGS
            }
            CaptureStep.OPENINGS -> {
                val wall = a.wallIndex ?: return "Aim at a wall"
                val hit = a.wallHit!!
                val first = pendingOpening
                if (first == null || first.first != wall) {
                    pendingOpening = wall to hit
                } else {
                    val v = outline!!
                    val len = v[wall].distanceTo(v[(wall + 1) % v.size])
                    val o = CaptureMath.openingFromHits("o${++counter}", openingType, first.second, hit, len, height!!, floorY)
                        ?: return "Too small. Aim at the opposite corner of the opening"
                    placed += PlacedOpening(wall, o)
                    pendingOpening = null
                }
            }
        }
        return null
    }

    /** Takes back the last tap, stepping back through the stages if needed. */
    fun undo() {
        when (step) {
            CaptureStep.OPENINGS -> when {
                pendingOpening != null -> pendingOpening = null
                placed.isNotEmpty() -> placed.removeAt(placed.size - 1)
                else -> { height = null; step = CaptureStep.HEIGHT }
            }
            CaptureStep.HEIGHT -> { outline = null; solve = null; closing = null; step = CaptureStep.CORNERS }
            CaptureStep.CORNERS -> if (taps.isNotEmpty()) taps.removeAt(taps.size - 1)
        }
    }

    fun toRoom(id: String, name: String): Room {
        check(complete) { "the room is not finished" }
        val v = outline!!
        return Room(
            id = id, name = name, height = height!!, vertices = v,
            walls = v.indices.map { i -> Wall("w${i + 1}", openings = placed.filter { it.wallIndex == i }.map { it.opening }) },
        )
    }

    private fun aimCorner(ray: Ray): Aim {
        val tap = CaptureMath.floorTap(ray, floorY) ?: return Aim(step)
        var p = tap.point
        if (taps.size >= 3 && p.distanceTo(taps[0]) <= options.closeRadius) {
            return Aim(step, floorPoint = taps[0], reliable = tap.reliable, wouldClose = true, segmentLength = taps[0].distanceTo(taps.last()))
        }
        if (angleSnap && taps.size >= 2) p = snapToPrevious(p)
        return Aim(step, floorPoint = p, reliable = tap.reliable, segmentLength = taps.lastOrNull()?.distanceTo(p))
    }

    /** Turns the new wall onto a right angle (or straight line) with the previous one if it is nearly there. */
    private fun snapToPrevious(p: Vec2): Vec2 {
        val last = taps.last()
        val prev = last - taps[taps.size - 2]
        val cur = p - last
        if (cur.length() < 1e-6 || prev.length() < 1e-6) return p
        val base = atan2(prev.z, prev.x)
        val rel = atan2(cur.z, cur.x) - base
        val target = Math.round(rel / (PI / 2)) * (PI / 2)
        var diff = rel - target
        while (diff > PI) diff -= 2 * PI
        while (diff < -PI) diff += 2 * PI
        if (abs(diff) > options.snapToleranceDeg * PI / 180) return p
        val dir = Vec2(cos(base + target), sin(base + target))
        // Keep the point under the reticle as far as possible: slide it onto the snapped line.
        return last + dir * cur.dot(dir)
    }

    private fun close(measuredFirstCorner: Vec2): String? {
        val result = PlanSolver.solve(taps, measuredFirstCorner, options.solve)
        if (!result.ok) return "These walls cross each other. Undo the last corners and try again"
        solve = result
        closing = measuredFirstCorner
        outline = if (Polygon.signedArea(result.vertices) >= 0) result.vertices
        else List(result.vertices.size) { result.vertices[(result.vertices.size - it) % result.vertices.size] }
        step = CaptureStep.HEIGHT
        return null
    }

    /** The nearest wall the ray hits within its length. */
    private fun aimWall(ray: Ray): Pair<Int, WallHit>? {
        val v = outline ?: return null
        var best: Pair<Int, WallHit>? = null
        for (i in v.indices) {
            val a = v[i]
            val b = v[(i + 1) % v.size]
            val hit = CaptureMath.wallHit(ray, a, b) ?: continue
            if (hit.along < 0 || hit.along > a.distanceTo(b)) continue
            if (best == null || hit.distance < best.second.distance) best = i to hit
        }
        return best
    }
}
