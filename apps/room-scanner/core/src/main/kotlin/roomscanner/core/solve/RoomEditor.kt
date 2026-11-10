package roomscanner.core.solve

import roomscanner.core.geometry.Vec2
import roomscanner.core.model.Pose2
import roomscanner.core.model.Project
import roomscanner.core.model.Room

/** Edits made on the review screen, after a room has been scanned. */
object RoomEditor {

    /**
     * Records a tape-measured length for one wall (or clears it with null) and re-solves the
     * room so every measured wall has its length. Returns the solver's warnings alongside.
     */
    fun setWallLength(room: Room, wallIndex: Int, length: Double?): Pair<Room, List<String>> {
        require(wallIndex in room.walls.indices)
        require(length == null || length > 0) { "length must be positive" }
        val walls = room.walls.mapIndexed { i, w -> if (i == wallIndex) w.copy(lockedLength = length) else w }
        val locks = walls.withIndex().mapNotNull { (i, w) -> w.lockedLength?.let { i to it } }.toMap()
        if (locks.isEmpty()) return room.copy(walls = walls) to emptyList()
        val result = PlanSolver.solve(room.vertices, options = SolveOptions(lockedLengths = locks))
        if (!result.ok) return room to result.warnings
        // Openings keep their distance from the wall's start; trim any that no longer fit.
        val fitted = walls.mapIndexed { i, w ->
            val len = result.vertices[i].distanceTo(result.vertices[(i + 1) % result.vertices.size])
            w.copy(openings = w.openings.filter { it.offset < len - 0.05 }.map {
                if (it.offset + it.width > len) it.copy(width = len - it.offset) else it
            })
        }
        return room.copy(vertices = result.vertices, walls = fitted) to result.warnings
    }

    /**
     * Rooms scanned in a new AR session share no frame with the rooms already in the project.
     * Shifts them to sit beside the existing ones, [gap] metres clear, so nothing overlaps.
     */
    fun placeBeside(project: Project, newRooms: List<Room>, gap: Double = 1.0): List<Room> {
        if (project.rooms.isEmpty() || newRooms.isEmpty()) return newRooms
        fun xs(rooms: List<Room>) = rooms.flatMap { r -> r.vertices.map { r.toProject(it).x } }
        fun zs(rooms: List<Room>) = rooms.flatMap { r -> r.vertices.map { r.toProject(it).z } }
        val shift = Vec2(xs(project.rooms).max() + gap - xs(newRooms).min(), zs(project.rooms).min() - zs(newRooms).min())
        return newRooms.map { it.copy(origin = Pose2(it.origin.x + shift.x, it.origin.z + shift.z, it.origin.yaw)) }
    }
}
