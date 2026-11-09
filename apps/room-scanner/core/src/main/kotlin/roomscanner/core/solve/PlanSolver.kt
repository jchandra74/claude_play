package roomscanner.core.solve

import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

data class SolveOptions(
    /** Snap walls that are nearly parallel or perpendicular to the room's main direction. */
    val squareCorners: Boolean = true,
    val snapToleranceDeg: Double = 7.0,
    /** Wall index to a length the user measured, in metres. */
    val lockedLengths: Map<Int, Double> = emptyMap(),
    val minWallLength: Double = 0.10,
)

data class SolveResult(
    /** Adjusted corners, in the same order as the input. */
    val vertices: List<Vec2>,
    /** How far the scan missed closing on its first corner, before any adjustment. Null if not measured. */
    val closureGap: Double?,
    /** Per wall: whether it was snapped to the room's main axes. */
    val snapped: List<Boolean>,
    /** Largest remaining violation of a snap or locked-length constraint, in metres. */
    val maxResidual: Double,
    val warnings: List<String>,
) {
    val ok: Boolean get() = warnings.none { it.startsWith("error:") }
}

/**
 * Turns tapped corners into a clean room polygon.
 *
 * Steps, in order: spread the closure gap along the walls, snap near-square walls to the room's
 * main axes, rescale to the measured wall lengths, then solve all constraints together while
 * moving corners as little as possible.
 */
object PlanSolver {

    /**
     * @param corners the tapped corners in order around the room.
     * @param closingPoint the first corner as re-measured at the end of the lap, if the user
     *   tapped it again. The distance from `corners[0]` is the tracking drift over the lap.
     */
    fun solve(corners: List<Vec2>, closingPoint: Vec2? = null, options: SolveOptions = SolveOptions()): SolveResult {
        require(corners.size >= 3) { "a room needs at least 3 corners" }
        val n = corners.size
        val warnings = ArrayList<String>()

        var pts = if (closingPoint != null) distributeClosure(corners, closingPoint) else corners
        val gap = closingPoint?.distanceTo(corners[0])

        val dirs: List<Vec2?> = if (options.squareCorners) snapDirections(pts, options.snapToleranceDeg) else List(n) { null }
        pts = adjust(pts, dirs, emptyMap())

        val locks = options.lockedLengths.filterKeys { it in 0 until n }
        if (locks.isNotEmpty()) {
            val measured = locks.keys.sumOf { pts[it].distanceTo(pts[(it + 1) % n]) }
            val scale = locks.values.sum() / measured
            val c = Polygon.centroid(pts)
            pts = pts.map { c + (it - c) * scale }
            pts = adjust(pts, dirs, locks)
        }

        var residual = 0.0
        for (i in 0 until n) {
            val e = pts[(i + 1) % n] - pts[i]
            dirs[i]?.let { residual = maxOf(residual, abs(it.perpLeft().dot(e))) }
            locks[i]?.let { residual = maxOf(residual, abs(e.length() - it)) }
        }
        if (residual > 0.005) warnings += "the measured lengths and square corners disagree by ${"%.1f".format(residual * 100)} cm"

        if (!Polygon.isSimple(pts)) warnings += "error: walls cross each other"
        for (i in 0 until n) {
            if (pts[i].distanceTo(pts[(i + 1) % n]) < options.minWallLength) warnings += "wall ${i + 1} is shorter than ${(options.minWallLength * 100).roundToInt()} cm"
        }
        return SolveResult(pts, gap, dirs.map { it != null }, residual, warnings)
    }

    /**
     * Corners for a room captured in wall mode. Each wall is two points tapped along its base;
     * corner `i` is where wall `i - 1` meets wall `i`.
     *
     * @throws IllegalArgumentException if two neighbouring walls are within [minAngleDeg] of parallel.
     */
    fun cornersFromWallLines(walls: List<Pair<Vec2, Vec2>>, minAngleDeg: Double = 10.0): List<Vec2> {
        require(walls.size >= 3) { "a room needs at least 3 walls" }
        val n = walls.size
        return List(n) { i ->
            val prev = walls[(i + n - 1) % n]
            val cur = walls[i]
            val d1 = (prev.second - prev.first).normalized()
            val d2 = (cur.second - cur.first).normalized()
            require(abs(d1.cross(d2)) >= sin(minAngleDeg * PI / 180)) {
                "walls ${(i + n - 1) % n + 1} and ${i + 1} are too close to parallel to find their corner"
            }
            Polygon.lineIntersection(prev.first, prev.second, cur.first, cur.second)!!
        }
    }

    /** Compass-rule adjustment: each corner absorbs the gap in proportion to the distance walked to reach it. */
    private fun distributeClosure(corners: List<Vec2>, closingPoint: Vec2): List<Vec2> {
        val n = corners.size
        val gap = closingPoint - corners[0]
        val cum = DoubleArray(n)
        for (i in 1 until n) cum[i] = cum[i - 1] + corners[i].distanceTo(corners[i - 1])
        val total = cum[n - 1] + corners[n - 1].distanceTo(closingPoint)
        if (total < 1e-9) return corners
        return List(n) { corners[it] - gap * (cum[it] / total) }
    }

    /** For each wall, the axis-aligned unit direction it should take, or null to leave it free. */
    private fun snapDirections(pts: List<Vec2>, toleranceDeg: Double): List<Vec2?> {
        val n = pts.size
        // Length-weighted mean of wall directions modulo a quarter turn.
        var sx = 0.0
        var sz = 0.0
        for (i in 0 until n) {
            val e = pts[(i + 1) % n] - pts[i]
            val a = atan2(e.z, e.x)
            sx += e.length() * cos(4 * a)
            sz += e.length() * sin(4 * a)
        }
        val axis = atan2(sz, sx) / 4
        val tol = toleranceDeg * PI / 180
        return List(n) { i ->
            val e = pts[(i + 1) % n] - pts[i]
            if (e.length() < 1e-9) return@List null
            val a = atan2(e.z, e.x)
            val target = axis + Math.round((a - axis) / (PI / 2)) * (PI / 2)
            if (abs(a - target) <= tol) Vec2(cos(target), sin(target)) else null
        }
    }

    /**
     * Moves corners as little as possible (least squares) so that snapped walls lie along their
     * direction and locked walls have their measured length.
     */
    private fun adjust(base: List<Vec2>, dirs: List<Vec2?>, locks: Map<Int, Double>): List<Vec2> {
        val n = base.size
        if (dirs.all { it == null } && locks.isEmpty()) return base
        var cur = base
        // A free-angle locked wall is linearised along its current direction, so iterate.
        val passes = if (locks.keys.any { dirs[it] == null }) 12 else 1
        repeat(passes) {
            val ls = LeastSquares(2 * n)
            for (i in 0 until n) {
                ls.add(intArrayOf(2 * i), doubleArrayOf(1.0), base[i].x, 1.0)
                ls.add(intArrayOf(2 * i + 1), doubleArrayOf(1.0), base[i].z, 1.0)
            }
            for (i in 0 until n) {
                val j = (i + 1) % n
                val idx = intArrayOf(2 * j, 2 * j + 1, 2 * i, 2 * i + 1)
                dirs[i]?.let { d ->
                    val m = d.perpLeft()
                    ls.add(idx, doubleArrayOf(m.x, m.z, -m.x, -m.z), 0.0, HARD)
                }
                locks[i]?.let { len ->
                    val d = dirs[i] ?: (cur[j] - cur[i]).normalized()
                    ls.add(idx, doubleArrayOf(d.x, d.z, -d.x, -d.z), len, HARD)
                }
            }
            val x = ls.solve()
            cur = List(n) { Vec2(x[2 * it], x[2 * it + 1]) }
        }
        return cur
    }

    private const val HARD = 1e8
}
