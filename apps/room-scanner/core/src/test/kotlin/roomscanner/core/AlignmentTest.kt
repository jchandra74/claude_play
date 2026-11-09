package roomscanner.core

import roomscanner.core.export.ProjectJson
import roomscanner.core.model.Opening
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Pose2
import roomscanner.core.solve.RoomAlignment
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AlignmentTest {
    private fun door(offset: Double) = Opening("d", OpeningType.DOOR, offset = offset, width = 0.8, height = 2.0, linkId = "L")

    @Test fun `a room is placed face to face across a linked door`() {
        val a = room(rect(4.0, 3.0), name = "A", openings = mapOf(1 to listOf(door(1.0))))
        // B was scanned in some unrelated frame; its door is on a different wall.
        val b = room(rect(3.0, 3.0), name = "B", openings = mapOf(2 to listOf(door(0.7)))).copy(origin = Pose2(40.0, -7.0, 2.1))

        val pose = RoomAlignment.alignByDoor(a, b, "L", thickness = 0.15)!!
        val placed = b.copy(origin = pose)
        val fa = RoomAlignment.projectDoorFrame(a, 1, a.walls[1].openings[0])
        val fb = RoomAlignment.projectDoorFrame(placed, 2, placed.walls[2].openings[0])

        assertEquals(-1.0, fa.outward.dot(fb.outward), 1e-9)
        assertTrue((fa.center + fa.outward * 0.15).distanceTo(fb.center) < 1e-9)
        assertEquals(0.15, RoomAlignment.measuredThickness(a, placed, "L")!!, 1e-9)
        // B must end up outside A, beyond the x = 4 wall.
        placed.vertices.forEach { assertTrue(placed.toProject(it).x >= 4.15 - 1e-9) }
    }

    @Test fun `sample plan doors already line up`() {
        val p = ProjectJson.decode(File("../samples/two-rooms.json").readText()).normalized()
        val pose = RoomAlignment.alignByDoor(p.rooms[0], p.rooms[1], "L1", thickness = 0.2)!!
        assertEquals(5.2, pose.x, 1e-9)
        assertEquals(0.5, pose.z, 1e-9)
        assertEquals(0.0, pose.yaw, 1e-9)
    }
}
