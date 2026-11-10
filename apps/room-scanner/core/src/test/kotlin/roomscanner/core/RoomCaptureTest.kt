package roomscanner.core

import roomscanner.core.capture.CaptureStep
import roomscanner.core.capture.LineStyle
import roomscanner.core.capture.Overlay
import roomscanner.core.capture.Projector
import roomscanner.core.capture.Ray
import roomscanner.core.capture.RoomCapture
import roomscanner.core.geometry.Mat4
import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import roomscanner.core.geometry.Vec3
import roomscanner.core.geometry.at
import roomscanner.core.mesh.RoomMesher
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Pose2
import roomscanner.core.solve.RoomEditor
import kotlin.math.abs
import kotlin.math.tan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoomCaptureTest {
    private val floorY = -1.3
    private val eye = Vec3(2.0, floorY + 1.5, 1.5) // standing in the middle of a 4 x 3 room
    private fun at(p: Vec3) = Ray(eye, p - eye)
    private fun floor(x: Double, z: Double) = at(Vec3(x, floorY, z))

    /** Taps the four corners of a 4 x 3 room and closes it. */
    private fun closedRoom(): RoomCapture {
        val c = RoomCapture(floorY)
        for (p in rect(4.0, 3.0)) assertNull(c.tap(floor(p.x, p.z)))
        assertTrue(c.aim(floor(0.1, 0.05)).wouldClose)
        assertNull(c.tap(floor(0.03, 0.02)))
        return c
    }

    @Test fun `a full scan produces the room that was scanned`() {
        val c = closedRoom()
        assertEquals(CaptureStep.HEIGHT, c.step)
        assertEquals(0.036, c.solve!!.closureGap!!, 0.001)
        assertFalse(c.complete)

        // Ceiling edge on the far wall (z = 3).
        val edge = at(Vec3(1.0, floorY + 2.45, 3.0))
        assertEquals(2.45, c.aim(edge).height!!, 0.02)
        assertNull(c.tap(edge))
        assertEquals(CaptureStep.OPENINGS, c.step)
        assertTrue(c.complete)

        // A window on the far wall, by two diagonal corners.
        c.openingType = OpeningType.WINDOW
        assertNull(c.tap(at(Vec3(1.0, floorY + 0.9, 3.0))))
        assertNotNull(c.pendingOpening)
        assertNull(c.tap(at(Vec3(2.5, floorY + 2.0, 3.0))))
        assertNull(c.pendingOpening)

        val room = c.toRoom("r1", "Test")
        assertTrue(room.validate().isEmpty())
        assertEquals(12.0, Polygon.signedArea(room.vertices), 0.15)
        assertEquals(2.45, room.height, 0.02)
        val (wall, window) = room.walls.withIndex().single { it.value.openings.isNotEmpty() }.let { it.index to it.value.openings.single() }
        assertEquals(4.0, room.wallLength(wall), 0.05)
        assertEquals(1.5, window.width, 0.03); assertEquals(1.1, window.height, 0.03); assertEquals(0.9, window.sill, 0.03)
        // And it meshes.
        assertTrue(RoomMesher.mesh(project(room)).warnings.isEmpty())
    }

    @Test fun `nearly square corners snap while aiming, and free angle turns that off`() {
        val c = RoomCapture(floorY)
        c.tap(floor(0.0, 0.0)); c.tap(floor(4.0, 0.0))
        val snapped = c.aim(floor(4.15, 3.0)).floorPoint!!
        assertEquals(4.0, snapped.x, 1e-6); assertEquals(3.0, snapped.z, 1e-6)
        val slanted = c.aim(floor(5.5, 3.0)).floorPoint!!
        assertEquals(5.5, slanted.x, 1e-6)
        c.angleSnap = false
        assertEquals(4.15, c.aim(floor(4.15, 3.0)).floorPoint!!.x, 1e-6)
    }

    @Test fun `bad taps are refused with a reason`() {
        val c = RoomCapture(floorY)
        assertNotNull(c.tap(Ray(eye, Vec3(1.0, 0.2, 0.0))))          // sky
        c.tap(floor(0.0, 0.0))
        assertNotNull(c.tap(floor(0.01, 0.0)))                         // same spot
        assertFalse(c.aim(floor(0.1, 0.1)).wouldClose)                 // too few corners to close
        c.tap(floor(3.0, 3.0)); c.tap(floor(3.0, 0.0)); c.tap(floor(0.0, 3.0))
        assertNotNull(c.tap(floor(0.0, 0.0)))                          // bow-tie
        assertEquals(CaptureStep.CORNERS, c.step)

        val closed = closedRoom()
        assertNotNull(closed.tap(at(Vec3(1.0, floorY + 0.5, 3.0))))    // far too low for a ceiling
        assertNotNull(closed.tap(floor(2.0, 1.4)))                     // not a wall at all
    }

    @Test fun `undo walks back through every stage`() {
        val c = closedRoom()
        c.tap(at(Vec3(1.0, floorY + 2.4, 3.0)))
        c.tap(at(Vec3(1.0, floorY + 0.1, 3.0)))
        c.tap(at(Vec3(1.9, floorY + 2.0, 3.0)))
        assertEquals(1, c.openings.size)
        c.tap(at(Vec3(3.0, floorY + 1.0, 3.0)))
        c.undo(); assertNull(c.pendingOpening); assertEquals(1, c.openings.size)
        c.undo(); assertEquals(0, c.openings.size)
        c.undo(); assertEquals(CaptureStep.HEIGHT, c.step); assertNull(c.height)
        c.undo(); assertEquals(CaptureStep.CORNERS, c.step); assertEquals(4, c.corners.size)
        repeat(4) { c.undo() }
        assertFalse(c.canUndo)
        c.undo() // harmless
    }

    @Test fun `clockwise scans come out the same`() {
        val c = RoomCapture(floorY)
        for (p in listOf(Vec2(0.0, 0.0), Vec2(0.0, 3.0), Vec2(4.0, 3.0), Vec2(4.0, 0.0))) c.tap(floor(p.x, p.z))
        c.tap(floor(0.0, 0.0))
        assertTrue(Polygon.signedArea(c.outline!!) > 0)
        c.tap(at(Vec3(1.0, floorY + 2.4, 3.0)))
        assertEquals(12.0, Polygon.signedArea(c.toRoom("r", "R").vertices), 1e-6)
    }

    @Test fun `overlay follows the capture`() {
        val c = RoomCapture(floorY)
        assertTrue(Overlay.lines(c, null).isEmpty())
        c.tap(floor(0.0, 0.0)); c.tap(floor(4.0, 0.0))
        val far = c.aim(Ray(Vec3(2.0, floorY + 1.5, 1.5), Vec3(1.0, -0.1, 0.0)))
        assertFalse(far.reliable)
        assertTrue(Overlay.lines(c, far).any { it.style == LineStyle.GUIDE_WARN })
        c.tap(floor(4.0, 3.0)); c.tap(floor(0.0, 3.0))
        assertTrue(Overlay.lines(c, c.aim(floor(0.05, 0.0))).any { it.style == LineStyle.CLOSE })
        c.tap(floor(0.0, 0.0))
        val edge = at(Vec3(1.0, floorY + 2.4, 3.0))
        val preview = Overlay.lines(c, c.aim(edge))
        assertTrue(preview.any { it.style == LineStyle.HIGHLIGHT })
        assertTrue(preview.any { abs(it.a.y - (floorY + 2.4)) < 0.02 && it.style == LineStyle.GUIDE })
        assertEquals(floorY + 2.4, Overlay.target(c, c.aim(edge))!!.y, 0.02)
        c.tap(edge)
        c.tap(at(Vec3(1.0, floorY + 0.9, 3.0)))
        assertTrue(Overlay.lines(c, c.aim(at(Vec3(2.0, floorY + 2.0, 3.0)))).count { it.style == LineStyle.PENDING } == 4)
        c.tap(at(Vec3(2.0, floorY + 2.0, 3.0)))
        assertEquals(4, Overlay.lines(c, null).count { it.style == LineStyle.OPENING })
    }

    // Projection: a camera at the origin looking down -Z, 90 degree vertical field of view.
    private fun perspective(fovY: Double, aspect: Double, near: Double, far: Double): Mat4 {
        val f = 1 / tan(fovY / 2)
        return Mat4(doubleArrayOf(f / aspect, 0.0, 0.0, 0.0, 0.0, f, 0.0, 0.0, 0.0, 0.0, (far + near) / (near - far), -1.0, 0.0, 0.0, 2 * far * near / (near - far), 0.0))
    }
    private val projector = Projector(perspective(Math.PI / 2, 2.0, 0.05, 50.0), 2000, 1000)

    @Test fun `points project to the right pixels`() {
        val centre = projector.project(Vec3(0.0, 0.0, -5.0))!!
        assertEquals(1000f, centre.x, 0.01f); assertEquals(500f, centre.y, 0.01f)
        val upRight = projector.project(Vec3(2.0, 2.0, -2.0))!! // 45 degrees up: top edge
        assertEquals(1500f, upRight.x, 0.01f); assertEquals(0f, upRight.y, 0.01f)
        assertNull(projector.project(Vec3(0.0, 0.0, 3.0)))
    }

    @Test fun `lines are clipped where they pass behind the camera`() {
        assertNull(projector.project(Vec3(-1.0, 0.0, 2.0), Vec3(1.0, 0.0, 3.0)))
        // A floor line running from in front of the camera to behind it stays on its true screen line.
        val s = projector.project(Vec3(1.0, -1.0, -4.0), Vec3(1.0, -1.0, 4.0))!!
        assertEquals(1000f + 500f / 4 , s.a.x, 0.01f)
        assertTrue(s.b.x > 2000f && s.b.y > 1000f) // heads off the bottom-right, never flips to the top
    }

    @Test fun `the reticle ray is the inverse of projection`() {
        val r = projector.ray()!!
        assertEquals(0.0, r.origin.x, 1e-9); assertEquals(-1.0, r.dir.z, 1e-9)
        val target = Vec3(1.3, -0.4, -6.0)
        val px = projector.project(target)!!
        val back = projector.ray(px.x, px.y)!!
        val along = (target - back.origin).normalized()
        assertTrue(along.dot(back.dir) > 1 - 1e-6) // float pixel coordinates limit the precision
        assertEquals(1.0, (Mat4.IDENTITY * Mat4.IDENTITY).inverse()!!.m[5], 1e-12)
    }

    @Test fun `a measured wall re-solves a scanned room and keeps its openings`() {
        val c = closedRoom()
        c.tap(at(Vec3(1.0, floorY + 2.4, 3.0)))
        c.tap(at(Vec3(1.0, floorY + 0.1, 3.0))); c.tap(at(Vec3(1.9, floorY + 2.0, 3.0)))
        val room = c.toRoom("r", "R")
        val wall = room.walls.indexOfFirst { it.openings.isNotEmpty() }
        val (fixed, warnings) = RoomEditor.setWallLength(room, wall, 4.1)
        assertTrue(warnings.isEmpty())
        assertEquals(4.1, fixed.wallLength(wall), 1e-5)
        assertEquals(4.1, fixed.walls[wall].lockedLength)
        assertEquals(1, fixed.walls[wall].openings.size)
        assertEquals(3.0 * 4.1 / 4.0, fixed.wallLength((wall + 1) % 4), 0.03) // the room scaled with it
        val (cleared, _) = RoomEditor.setWallLength(fixed, wall, null)
        assertNull(cleared.walls[wall].lockedLength)
    }

    @Test fun `rooms from a new session are placed clear of existing ones`() {
        val existing = project(room(rect(4.0, 3.0), name = "A").copy(origin = Pose2(2.0, 5.0, 0.0)))
        val placed = RoomEditor.placeBeside(existing, listOf(room(rect(3.0, 3.0), name = "B").copy(origin = Pose2(-9.0, -9.0, 0.3))))
        val xs = placed[0].vertices.map { placed[0].toProject(it).x }
        val zs = placed[0].vertices.map { placed[0].toProject(it).z }
        assertEquals(7.0, xs.min(), 1e-9)
        assertEquals(5.0, zs.min(), 1e-9)
        assertEquals(0.3, placed[0].origin.yaw)
    }
}
