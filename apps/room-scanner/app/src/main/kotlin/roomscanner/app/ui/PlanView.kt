package roomscanner.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import roomscanner.core.model.Room

/**
 * A top-down drawing of rooms, fitted to the available space. North is whatever way the scan
 * started; x runs right and z runs down, matching a view from above.
 *
 * @param selectedWall a wall of the single room shown, to highlight.
 * @param showLengths label every wall with its length.
 */
@Composable
fun PlanView(rooms: List<Room>, modifier: Modifier = Modifier, selectedWall: Int? = null, showLengths: Boolean = false) {
    val measurer = rememberTextMeasurer()
    Canvas(modifier) {
        val pts = rooms.flatMap { r -> r.vertices.map { r.toProject(it) } }
        if (pts.isEmpty()) return@Canvas
        val minX = pts.minOf { it.x }; val maxX = pts.maxOf { it.x }
        val minZ = pts.minOf { it.z }; val maxZ = pts.maxOf { it.z }
        val pad = 28.dp.toPx()
        val scale = minOf((size.width - 2 * pad) / (maxX - minX).coerceAtLeast(0.1), (size.height - 2 * pad) / (maxZ - minZ).coerceAtLeast(0.1)).toFloat()
        val ox = (size.width - (maxX - minX).toFloat() * scale) / 2
        val oz = (size.height - (maxZ - minZ).toFloat() * scale) / 2
        fun map(p: Vec2) = Offset(ox + (p.x - minX).toFloat() * scale, oz + (p.z - minZ).toFloat() * scale)

        val wallColor = Color(0xFFE6E6E6)
        val fill = Color(0x337FE0D4)
        val openingColor = Color(0xFFFFC857)
        val selected = Color(0xFF7FE0D4)
        val labelStyle = TextStyle(color = Color.White, fontSize = 11.sp)

        for (room in rooms) {
            val v = room.vertices.map { map(room.toProject(it)) }
            val path = Path().apply {
                moveTo(v[0].x, v[0].y)
                for (i in 1 until v.size) lineTo(v[i].x, v[i].y)
                close()
            }
            drawPath(path, fill)
            for (i in v.indices) {
                val a = v[i]; val b = v[(i + 1) % v.size]
                val isSelected = rooms.size == 1 && selectedWall == i
                drawLine(if (isSelected) selected else wallColor, a, b, strokeWidth = (if (isSelected) 5.dp else 3.dp).toPx(), cap = StrokeCap.Round)
                val len = room.wallLength(i)
                if (len > 1e-6 && i < room.walls.size) {
                    for (o in room.walls[i].openings) {
                        val s = a + (b - a) * (o.offset / len).toFloat()
                        val e = a + (b - a) * ((o.offset + o.width) / len).toFloat()
                        drawLine(openingColor, s, e, strokeWidth = 5.dp.toPx(), cap = StrokeCap.Butt)
                    }
                }
                if (showLengths) {
                    val text = measurer.measure(metres(len), labelStyle)
                    val mid = (a + b) / 2f
                    drawText(text, topLeft = Offset(mid.x - text.size.width / 2f, mid.y - text.size.height / 2f))
                }
            }
            if (rooms.size > 1) {
                val c = map(room.toProject(Polygon.centroid(room.vertices)))
                val text = measurer.measure(room.name, labelStyle)
                drawText(text, topLeft = Offset(c.x - text.size.width / 2f, c.y - text.size.height / 2f))
            }
        }
    }
}
