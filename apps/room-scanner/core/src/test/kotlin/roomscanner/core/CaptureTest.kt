package roomscanner.core

import roomscanner.core.capture.CaptureMath
import roomscanner.core.capture.Ray
import roomscanner.core.geometry.Vec2
import roomscanner.core.geometry.Vec3
import roomscanner.core.geometry.at
import roomscanner.core.model.OpeningType
import roomscanner.core.solve.PlanSolver
import roomscanner.core.solve.SolveOptions
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CaptureTest {
    private val floorY = -1.3
    private fun aim(from: Vec3, at: Vec3) = Ray(from, at - from)

    @Test fun `floor tap lands where the reticle points`() {
        val cam = Vec3(1.0, 0.2, 1.0)
        val tap = CaptureMath.floorTap(aim(cam, Vec3(3.0, floorY, 2.5)), floorY)!!
        assertEquals(3.0, tap.point.x, 1e-9); assertEquals(2.5, tap.point.z, 1e-9)
        assertTrue(tap.reliable)
    }

    @Test fun `aiming at the horizon or far away is flagged`() {
        val cam = Vec3(0.0, 0.2, 0.0)
        assertNull(CaptureMath.floorTap(Ray(cam, Vec3(1.0, 0.0, 0.0)), floorY))
        assertNull(CaptureMath.floorTap(Ray(cam, Vec3(1.0, 0.5, 0.0)), floorY))
        assertFalse(CaptureMath.floorTap(aim(cam, Vec3(9.0, floorY, 0.0)), floorY)!!.reliable)
    }

    @Test fun `ceiling height from one tap on the wall-ceiling edge`() {
        val a = Vec2(0.0, 4.0); val b = Vec2(5.0, 4.0)
        val cam = Vec3(2.0, 0.2, 1.0)
        val h = CaptureMath.ceilingHeight(aim(cam, Vec3(3.1, floorY + 2.42, 4.0)), a, b, floorY)!!
        assertEquals(2.42, h, 1e-9)
        // Looking away from the wall gives nothing.
        assertNull(CaptureMath.ceilingHeight(aim(cam, Vec3(3.1, 1.0, -4.0)), a, b, floorY))
    }

    @Test fun `opening from two diagonal taps`() {
        val a = Vec2(0.0, 4.0); val b = Vec2(5.0, 4.0)
        val cam = Vec3(2.0, 0.2, 1.0)
        val h1 = CaptureMath.wallHit(aim(cam, Vec3(1.5, floorY + 2.1, 4.0)), a, b)!!
        val h2 = CaptureMath.wallHit(aim(cam, Vec3(3.1, floorY + 0.9, 4.0)), a, b)!!
        val w = CaptureMath.openingFromHits("o", OpeningType.WINDOW, h1, h2, 5.0, 2.4, floorY)!!
        assertEquals(1.5, w.offset, 1e-9); assertEquals(1.6, w.width, 1e-9)
        assertEquals(0.9, w.sill, 1e-9); assertEquals(1.2, w.height, 1e-9)
        // The same taps as a door reach the floor.
        val d = CaptureMath.openingFromHits("o", OpeningType.DOOR, h1, h2, 5.0, 2.4, floorY)!!
        assertEquals(0.0, d.sill, 1e-9); assertEquals(2.1, d.height, 1e-9)
        assertNull(CaptureMath.openingFromHits("o", OpeningType.WINDOW, h1, h1, 5.0, 2.4, floorY))
    }

    /**
     * A whole simulated scan: aiming error on every tap, 1.5 percent scale error, and drift that
     * leaves the lap 5 cm open. One measured wall should bring every wall within 2 cm.
     */
    @Test fun `simulated scan of an L-shaped room recovers its dimensions`() {
        val truth = L_SHAPE
        val rnd = Random(42)
        val scale = 1.015
        val drift = Vec2(0.04, 0.03)
        val perimeter = 21.0
        var walked = 0.0
        fun tapAt(target: Vec2): Vec2 {
            val seen = target * scale + drift * (walked / perimeter) + Vec2(rnd.nextDouble(-0.012, 0.012), rnd.nextDouble(-0.012, 0.012))
            // Stand about 2 m back from the corner, phone at chest height.
            val cam = (seen + (Vec2(1.5, 2.5) * scale - seen).normalized() * 2.0).at(floorY + 1.4)
            val tap = assertNotNull(CaptureMath.floorTap(aim(cam, seen.at(floorY)), floorY))
            assertTrue(tap.reliable)
            return tap.point
        }
        val taps = truth.indices.map { i ->
            if (i > 0) walked += truth[i].distanceTo(truth[i - 1])
            tapAt(truth[i])
        }
        walked = perimeter
        val closing = tapAt(truth[0])

        val r = PlanSolver.solve(taps, closing, SolveOptions(lockedLengths = mapOf(0 to 5.0)))
        assertTrue(r.ok)
        assertTrue(r.closureGap!! in 0.02..0.09)
        for (i in truth.indices) {
            val want = truth[i].distanceTo(truth[(i + 1) % truth.size])
            val got = r.vertices[i].distanceTo(r.vertices[(i + 1) % truth.size])
            assertEquals(want, got, 0.02, "wall ${i + 1}")
        }
    }
}
