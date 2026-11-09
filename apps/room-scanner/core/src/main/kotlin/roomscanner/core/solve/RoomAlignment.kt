package roomscanner.core.solve

import roomscanner.core.geometry.Vec2
import roomscanner.core.model.Opening
import roomscanner.core.model.Pose2
import roomscanner.core.model.Room
import kotlin.math.atan2

/** Joins rooms at a doorway that was marked from both sides. Rooms must be normalised. */
object RoomAlignment {

    /** A doorway as seen from one room: the middle of the opening on the wall line, and the way out. */
    data class DoorFrame(val center: Vec2, val outward: Vec2)

    data class Linked(val wallIndex: Int, val opening: Opening)

    fun findLinked(room: Room, linkId: String): Linked? {
        room.walls.forEachIndexed { i, w ->
            w.openings.firstOrNull { it.linkId == linkId }?.let { return Linked(i, it) }
        }
        return null
    }

    /** Door frame in the room's own coordinates. */
    fun localDoorFrame(room: Room, wallIndex: Int, opening: Opening): DoorFrame {
        val a = room.wallStart(wallIndex)
        val d = (room.wallEnd(wallIndex) - a).normalized()
        return DoorFrame(a + d * (opening.offset + opening.width / 2), -d.perpLeft())
    }

    fun projectDoorFrame(room: Room, wallIndex: Int, opening: Opening): DoorFrame {
        val f = localDoorFrame(room, wallIndex, opening)
        return DoorFrame(room.origin.apply(f.center), room.origin.rotate(f.outward))
    }

    /**
     * Wall thickness at a doorway, from two rooms scanned in the same AR session: the distance
     * between the two markings of the door, measured straight through the wall.
     */
    fun measuredThickness(a: Room, b: Room, linkId: String): Double? {
        val la = findLinked(a, linkId) ?: return null
        val lb = findLinked(b, linkId) ?: return null
        val fa = projectDoorFrame(a, la.wallIndex, la.opening)
        val fb = projectDoorFrame(b, lb.wallIndex, lb.opening)
        return (fb.center - fa.center).dot(fa.outward)
    }

    /**
     * The pose that puts [moving] on the far side of the linked doorway from [fixed]: the two
     * markings of the door face each other, centred, [thickness] apart.
     */
    fun alignByDoor(fixed: Room, moving: Room, linkId: String, thickness: Double): Pose2? {
        val lf = findLinked(fixed, linkId) ?: return null
        val lm = findLinked(moving, linkId) ?: return null
        val target = projectDoorFrame(fixed, lf.wallIndex, lf.opening)
        val local = localDoorFrame(moving, lm.wallIndex, lm.opening)
        val want = -target.outward
        val yaw = atan2(want.z, want.x) - atan2(local.outward.z, local.outward.x)
        val rotated = Pose2(yaw = yaw).rotate(local.center)
        val t = target.center + target.outward * thickness - rotated
        return Pose2(t.x, t.z, yaw)
    }
}
