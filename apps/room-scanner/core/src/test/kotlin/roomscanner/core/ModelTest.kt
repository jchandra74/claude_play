package roomscanner.core

import roomscanner.core.export.ProjectJson
import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import roomscanner.core.model.Opening
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Room
import roomscanner.core.solve.RoomAlignment
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ModelTest {
    @Test fun `reversing the winding keeps every opening in the same place`() {
        val door = Opening("d", OpeningType.DOOR, offset = 0.5, width = 0.8, height = 2.0)
        val cw = room(rect(4.0, 3.0).reversed(), openings = mapOf(1 to listOf(door)))
        assertTrue(Polygon.signedArea(cw.vertices) < 0)
        val before = RoomAlignment.localDoorFrame(cw, 1, door).center

        val n = cw.normalized()
        assertTrue(Polygon.signedArea(n.vertices) > 0)
        val (wallIndex, moved) = n.walls.withIndex().first { it.value.openings.isNotEmpty() }.let { it.index to it.value.openings[0] }
        val after = RoomAlignment.localDoorFrame(n, wallIndex, moved).center
        assertTrue(before.distanceTo(after) < 1e-9)
        assertEquals(n, n.normalized())
    }

    @Test fun `walls are filled in when a plan omits them`() {
        val r = Room(id = "r", name = "Bare", height = 2.4, vertices = rect(2.0, 2.0)).normalized()
        assertEquals(4, r.walls.size)
    }

    @Test fun `validation catches unusable rooms`() {
        assertTrue(room(rect(2.0, 2.0)).validate().isEmpty())
        assertTrue(room(rect(2.0, 2.0), height = 0.0).validate().isNotEmpty())
        assertTrue(room(listOf(Vec2(0.0, 0.0), Vec2(2.0, 2.0), Vec2(2.0, 0.0), Vec2(0.0, 2.0))).validate().isNotEmpty())
    }

    @Test fun `sample plan round-trips through json`() {
        val p = ProjectJson.decode(File("../samples/two-rooms.json").readText())
        assertEquals(2, p.rooms.size)
        assertEquals(p, ProjectJson.decode(ProjectJson.encode(p)))
        assertTrue(p.validate().isEmpty())
    }
}
