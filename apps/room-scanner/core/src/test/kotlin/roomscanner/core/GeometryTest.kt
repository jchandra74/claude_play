package roomscanner.core

import roomscanner.core.geometry.Polygon
import roomscanner.core.geometry.Vec2
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GeometryTest {
    @Test fun `area sign follows winding`() {
        assertEquals(12.0, Polygon.signedArea(rect(4.0, 3.0)), 1e-12)
        assertEquals(-12.0, Polygon.signedArea(rect(4.0, 3.0).reversed()), 1e-12)
        assertEquals(23.75, Polygon.signedArea(L_SHAPE), 1e-12)
    }

    @Test fun `interior is on the left of each edge`() {
        val r = rect(4.0, 3.0)
        val c = Polygon.centroid(r)
        for (i in r.indices) {
            val inward = (r[(i + 1) % 4] - r[i]).perpLeft()
            assertTrue(inward.dot(c - r[i]) > 0)
        }
    }

    @Test fun `simple and crossing polygons`() {
        assertTrue(Polygon.isSimple(L_SHAPE))
        assertFalse(Polygon.isSimple(listOf(Vec2(0.0, 0.0), Vec2(2.0, 2.0), Vec2(2.0, 0.0), Vec2(0.0, 2.0))))
    }

    @Test fun `line intersection`() {
        val p = Polygon.lineIntersection(Vec2(0.0, 1.0), Vec2(5.0, 1.0), Vec2(2.0, -3.0), Vec2(2.0, 9.0))!!
        assertEquals(2.0, p.x, 1e-12); assertEquals(1.0, p.z, 1e-12)
        assertNull(Polygon.lineIntersection(Vec2(0.0, 0.0), Vec2(1.0, 0.0), Vec2(0.0, 1.0), Vec2(1.0, 1.0)))
    }

    @Test fun `triangulation covers the polygon exactly`() {
        for (poly in listOf(rect(4.0, 3.0), L_SHAPE)) {
            val tris = Polygon.triangulate(poly)
            assertEquals(poly.size - 2, tris.size)
            val area = tris.sumOf { t ->
                val a = (poly[t[1]] - poly[t[0]]).cross(poly[t[2]] - poly[t[0]]) / 2
                assertTrue(a > 0, "triangle is wound the wrong way")
                a
            }
            assertTrue(abs(area - Polygon.signedArea(poly)) < 1e-9)
        }
    }
}
