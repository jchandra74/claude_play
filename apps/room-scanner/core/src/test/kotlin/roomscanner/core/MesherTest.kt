package roomscanner.core

import roomscanner.core.geometry.Vec3
import roomscanner.core.mesh.Category
import roomscanner.core.mesh.RoomMesher
import roomscanner.core.model.ExportMode
import roomscanner.core.model.Opening
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Pose2
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class MesherTest {
    private val door = Opening("door", OpeningType.DOOR, offset = 1.0, width = 0.8, height = 2.0)
    private val window = Opening("win", OpeningType.WINDOW, offset = 0.5, sill = 0.9, width = 1.2, height = 1.1)
    private val tall = Opening("tall", OpeningType.DOOR, offset = 2.5, width = 1.0, height = 2.4) // floor to ceiling

    @Test fun `shell room has the right surfaces and they face inward`() {
        val m = RoomMesher.mesh(project(room(rect(4.0, 3.0), name = "living room")), ExportMode.SHELL)
        val parts = m.rooms.single().parts
        assertEquals(
            listOf("LivingRoom_Wall_01", "LivingRoom_Wall_02", "LivingRoom_Wall_03", "LivingRoom_Wall_04", "LivingRoom_Floor", "LivingRoom_Ceiling"),
            parts.map { it.name },
        )
        val centre = Vec3(2.0, 1.2, 1.5)
        for (p in parts) {
            assertNormalsMatchWinding(p)
            for (i in 0 until p.vertexCount) assertTrue(p.normal(i).dot(centre - p.vertex(i)) > 0, "${p.name} faces away from the room")
        }
        assertEquals(14.0 * 2.4, parts.filter { it.category == Category.WALL }.sumOf { it.area() }, 1e-4)
        assertEquals(12.0, parts.single { it.category == Category.FLOOR }.area(), 1e-5)
        assertEquals(12.0, parts.single { it.category == Category.CEILING }.area(), 1e-5)
    }

    @Test fun `openings are cut out of shell walls`() {
        val r = room(L_SHAPE, openings = mapOf(0 to listOf(window, tall), 1 to listOf(door)))
        val parts = RoomMesher.mesh(project(r), ExportMode.SHELL).rooms.single().parts
        val cut = 1.2 * 1.1 + 1.0 * 2.4 + 0.8 * 2.0
        assertEquals(21.0 * 2.4 - cut, parts.filter { it.category == Category.WALL }.sumOf { it.area() }, 1e-4)
        assertEquals(23.75, parts.single { it.category == Category.FLOOR }.area(), 1e-4)
    }

    @Test fun `solid walls are closed, outward-facing and have the right volume`() {
        val t = 0.1
        val m = RoomMesher.mesh(project(room(rect(4.0, 3.0))), ExportMode.SOLID, t)
        val walls = m.rooms.single().parts.filter { it.category == Category.WALL }
        assertEquals(4, walls.size)
        walls.forEach { assertClosedSolid(it); assertNormalsMatchWinding(it); assertTrue(it.volume() > 0) }
        assertEquals((4.2 * 3.2 - 12.0) * 2.4, walls.sumOf { it.volume() }, 1e-4)
    }

    @Test fun `solid walls stay closed with openings, on a room with an inside corner`() {
        val t = 0.12
        val r = room(L_SHAPE, openings = mapOf(0 to listOf(window, tall), 1 to listOf(door), 3 to listOf(window.copy(id = "w2", width = 0.6))))
        val m = RoomMesher.mesh(project(r), ExportMode.SOLID, t)
        assertTrue(m.warnings.isEmpty(), m.warnings.toString())
        val parts = m.rooms.single().parts
        val walls = parts.filter { it.category == Category.WALL }
        assertEquals(6, walls.size)
        walls.forEach { assertClosedSolid(it); assertNormalsMatchWinding(it); assertTrue(it.volume() > 0) }

        // Offsetting a polygon with only right angles adds perimeter * t + 4 t^2 of footprint.
        val footprint = 21.0 * t + 4 * t * t
        val cut = (1.2 * 1.1 + 0.6 * 1.1 + 1.0 * 2.4 + 0.8 * 2.0) * t
        assertEquals(footprint * 2.4 - cut, walls.sumOf { it.volume() }, 1e-4)

        // Doorways get a strip of floor through the wall; the full-height one gets ceiling too.
        assertEquals(23.75 + (0.8 + 1.0) * t, parts.single { it.category == Category.FLOOR }.area(), 1e-4)
        assertEquals(23.75 + 1.0 * t, parts.single { it.category == Category.CEILING }.area(), 1e-4)
    }

    @Test fun `textures map at true scale on every face, in both modes`() {
        val r = room(L_SHAPE, openings = mapOf(0 to listOf(window, tall), 1 to listOf(door))).copy(origin = Pose2(3.0, -1.0, 0.4))
        for (mode in ExportMode.entries) {
            RoomMesher.mesh(project(r), mode, 0.12).rooms.single().parts.forEach { assertUvsAreTrueScale(it) }
        }
    }

    @Test fun `room-side wall face maps to distance along the wall and height`() {
        val parts = RoomMesher.mesh(project(room(rect(4.0, 3.0)).copy(origin = Pose2(7.0, 2.0, 1.1))), ExportMode.SOLID, 0.1).rooms.single().parts
        val wall = parts[1] // the 3 m wall
        val face = wall.surfaces.single { it.material == "Room_Wall_02" }.indices
        val us = face.map { wall.uv(it).x }
        val vs = face.map { wall.uv(it).z }
        assertEquals(0.0, us.min(), 1e-5); assertEquals(3.0, us.max(), 1e-5)
        assertEquals(0.0, vs.min(), 1e-5); assertEquals(2.4, vs.max(), 1e-5)
    }

    @Test fun `each object has its own material, and solid walls split face from body`() {
        val solid = RoomMesher.mesh(project(room(rect(4.0, 3.0), openings = mapOf(0 to listOf(window)))), ExportMode.SOLID, 0.1).rooms.single().parts
        val wall = solid[0]
        assertEquals(listOf("Room_Wall_01", "Room_Wall_01_Body"), wall.surfaces.map { it.material })
        // The face surface is exactly the room-side face: wall area minus the window.
        val face = wall.surfaces[0].indices
        val faceArea = (0 until face.size / 3).sumOf { t ->
            val a = wall.vertex(face[3 * t]); val b = wall.vertex(face[3 * t + 1]); val c = wall.vertex(face[3 * t + 2])
            (b - a).cross(c - a).length() / 2
        }
        assertEquals(4.0 * 2.4 - 1.2 * 1.1, faceArea, 1e-4)
        assertEquals(listOf("Room_Floor"), solid.single { it.category == Category.FLOOR }.surfaces.map { it.material })

        val shell = RoomMesher.mesh(project(room(rect(4.0, 3.0))), ExportMode.SHELL).rooms.single().parts
        assertEquals(listOf("Room_Wall_01"), shell[0].surfaces.map { it.material })
        val all = shell.flatMap { p -> p.surfaces.map { it.material } }
        assertEquals(all.size, all.toSet().size)
    }

    @Test fun `overlapping openings merge into one hole`() {
        val a = Opening("a", OpeningType.WINDOW, offset = 1.0, sill = 0.5, width = 1.0, height = 1.0)
        val b = Opening("b", OpeningType.WINDOW, offset = 1.5, sill = 1.0, width = 1.0, height = 1.0)
        val m = RoomMesher.mesh(project(room(rect(4.0, 3.0), openings = mapOf(0 to listOf(a, b)))), ExportMode.SOLID, 0.1)
        val wall = m.rooms.single().parts.first()
        assertClosedSolid(wall)
        val solidVolume = (4.0 + 0.1 + 0.1 + 4.0) / 2 * 0.1 * 2.4 // trapezoid footprint between mitres
        assertEquals(solidVolume - 1.75 * 0.1, wall.volume(), 1e-4)
    }

    @Test fun `an opening that hangs off the wall is trimmed and reported`() {
        val wide = Opening("wide", OpeningType.WINDOW, offset = 3.5, sill = 0.9, width = 2.0, height = 1.0)
        val gone = Opening("gone", OpeningType.WINDOW, offset = 9.0, sill = 0.9, width = 1.0, height = 1.0)
        val m = RoomMesher.mesh(project(room(rect(4.0, 3.0), openings = mapOf(0 to listOf(wide, gone)))), ExportMode.SOLID, 0.1)
        assertTrue(m.warnings.any { "wide" in it && "trimmed" in it })
        assertTrue(m.warnings.any { "gone" in it && "left out" in it })
        assertClosedSolid(m.rooms.single().parts.first())
    }

    @Test fun `room pose is applied and the model starts at the origin`() {
        val placed = room(rect(4.0, 3.0), name = "A").copy(origin = Pose2(10.0, 5.0, Math.PI / 2))
        val second = room(rect(2.0, 2.0), name = "A").copy(origin = Pose2(20.0, 5.0, 0.0))
        val m = RoomMesher.mesh(project(placed, second), ExportMode.SHELL)
        assertEquals(listOf("A", "A_2"), m.rooms.map { it.name })
        val floor = m.rooms[0].parts.single { it.category == Category.FLOOR }
        val xs = (0 until floor.vertexCount).map { floor.vertex(it).x }
        val zs = (0 until floor.vertexCount).map { floor.vertex(it).z }
        // Turned a quarter turn: 4 m now runs along z, and 3 m along -x.
        assertEquals(-3.0, xs.min(), 1e-5); assertEquals(0.0, xs.max(), 1e-5)
        assertEquals(0.0, zs.min(), 1e-5); assertEquals(4.0, zs.max(), 1e-5)
        val other = m.rooms[1].parts.single { it.category == Category.FLOOR }
        assertEquals(10.0, (0 until other.vertexCount).minOf { other.vertex(it).x }, 1e-5)
    }

    @Test fun `clockwise input gives the same model`() {
        val a = RoomMesher.mesh(project(room(rect(4.0, 3.0))), ExportMode.SOLID, 0.1)
        val b = RoomMesher.mesh(project(room(rect(4.0, 3.0).reversed())), ExportMode.SOLID, 0.1, recenter = false)
        assertEquals(a.rooms[0].parts.sumOf { it.volume() }, b.rooms[0].parts.sumOf { it.volume() }, 1e-5)
        b.rooms[0].parts.filter { it.category == Category.WALL }.forEach { assertClosedSolid(it) }
    }

    @Test fun `invalid plans are refused`() {
        assertFailsWith<IllegalArgumentException> { RoomMesher.mesh(project(room(rect(4.0, 3.0), height = 0.0))) }
    }
}
