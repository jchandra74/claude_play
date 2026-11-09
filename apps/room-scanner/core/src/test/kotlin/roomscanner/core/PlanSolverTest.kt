package roomscanner.core

import roomscanner.core.geometry.Vec2
import roomscanner.core.model.Pose2
import roomscanner.core.solve.PlanSolver
import roomscanner.core.solve.SolveOptions
import kotlin.math.abs
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlanSolverTest {
    private fun lengths(p: List<Vec2>) = p.indices.map { p[it].distanceTo(p[(it + 1) % p.size]) }
    private fun cornerDots(p: List<Vec2>) = p.indices.map {
        val a = (p[(it + 1) % p.size] - p[it]).normalized()
        val b = (p[(it + 2) % p.size] - p[(it + 1) % p.size]).normalized()
        a.dot(b)
    }

    @Test fun `noisy rectangle at an arbitrary heading becomes square`() {
        val rnd = Random(7)
        val pose = Pose2(3.0, -2.0, 0.35)
        val taps = rect(4.0, 3.0).map { pose.apply(it) + Vec2(rnd.nextDouble(-0.02, 0.02), rnd.nextDouble(-0.02, 0.02)) }
        val r = PlanSolver.solve(taps)
        assertTrue(r.ok)
        assertEquals(listOf(true, true, true, true), r.snapped)
        cornerDots(r.vertices).forEach { assertTrue(abs(it) < 1e-6, "corner is not square: $it") }
        lengths(r.vertices).zip(listOf(4.0, 3.0, 4.0, 3.0)).forEach { (got, want) -> assertEquals(want, got, 0.04) }
        assertNull(r.closureGap)
    }

    @Test fun `closure gap is reported and spread back along the walls`() {
        // Drift that grows steadily with distance walked.
        val truth = L_SHAPE
        val drift = Vec2(0.06, -0.04)
        val perimeter = 21.0
        var walked = 0.0
        val taps = truth.indices.map { i ->
            if (i > 0) walked += truth[i].distanceTo(truth[i - 1])
            truth[i] + drift * (walked / perimeter)
        }
        val r = PlanSolver.solve(taps, closingPoint = truth[0] + drift, options = SolveOptions(squareCorners = false))
        assertEquals(drift.length(), r.closureGap!!, 1e-12)
        // Not exact: the solver only knows the drifted distances, not the true ones.
        r.vertices.zip(truth).forEach { (got, want) -> assertTrue(got.distanceTo(want) < 0.001) }
    }

    @Test fun `one measured wall rescales the whole room`() {
        val taps = rect(4.0, 3.0).map { it * 1.02 }
        val r = PlanSolver.solve(taps, options = SolveOptions(lockedLengths = mapOf(0 to 4.0)))
        lengths(r.vertices).zip(listOf(4.0, 3.0, 4.0, 3.0)).forEach { (got, want) -> assertEquals(want, got, 1e-6) }
        assertTrue(r.maxResidual < 1e-6)
        assertTrue(r.warnings.isEmpty())
    }

    @Test fun `a slanted wall is left alone while the rest is squared`() {
        val taps = listOf(Vec2(0.01, 0.0), Vec2(4.0, 0.02), Vec2(4.0, 2.0), Vec2(3.0, 3.01), Vec2(0.0, 3.0))
        val r = PlanSolver.solve(taps)
        assertEquals(listOf(true, true, false, true, true), r.snapped)
        val slant = r.vertices[3] - r.vertices[2]
        assertTrue(abs(slant.x) > 0.9 && abs(slant.z) > 0.9)
    }

    @Test fun `two measured walls on a free-angle room are both honoured`() {
        val taps = listOf(Vec2(0.0, 0.0), Vec2(4.0, 0.3), Vec2(4.6, 3.1), Vec2(-0.4, 2.7))
        val before = lengths(taps)
        val locks = mapOf(0 to before[0] + 0.05, 2 to before[2] - 0.04)
        val r = PlanSolver.solve(taps, options = SolveOptions(squareCorners = false, lockedLengths = locks))
        val after = lengths(r.vertices)
        assertEquals(locks[0]!!, after[0], 1e-5)
        assertEquals(locks[2]!!, after[2], 1e-5)
        r.vertices.zip(taps).forEach { (got, was) -> assertTrue(got.distanceTo(was) < 0.1) }
    }

    @Test fun `contradictory measurements are reported, not hidden`() {
        val r = PlanSolver.solve(rect(4.0, 3.0), options = SolveOptions(lockedLengths = mapOf(0 to 4.0, 2 to 4.2)))
        assertTrue(r.maxResidual > 0.05)
        assertTrue(r.warnings.any { "disagree" in it })
    }

    @Test fun `crossing walls are an error`() {
        val r = PlanSolver.solve(listOf(Vec2(0.0, 0.0), Vec2(3.0, 3.0), Vec2(3.0, 0.0), Vec2(0.0, 3.0)), options = SolveOptions(squareCorners = false))
        assertFalse(r.ok)
    }

    @Test fun `wall mode finds corners that were never tapped`() {
        val truth = rect(4.0, 3.0)
        // Two points somewhere along each wall, away from the (hidden) corners.
        val walls = truth.indices.map { i ->
            val a = truth[i]; val b = truth[(i + 1) % 4]
            (a + (b - a) * 0.3) to (a + (b - a) * 0.8)
        }
        val corners = PlanSolver.cornersFromWallLines(walls)
        corners.zip(truth).forEach { (got, want) -> assertTrue(got.distanceTo(want) < 1e-9) }
    }

    @Test fun `wall mode rejects near-parallel neighbours`() {
        val walls = listOf(
            Vec2(0.0, 0.0) to Vec2(2.0, 0.0),
            Vec2(2.5, 0.05) to Vec2(4.0, 0.2),
            Vec2(4.0, 1.0) to Vec2(4.0, 3.0),
            Vec2(3.0, 3.0) to Vec2(0.0, 3.0),
        )
        assertFailsWith<IllegalArgumentException> { PlanSolver.cornersFromWallLines(walls) }
    }
}
