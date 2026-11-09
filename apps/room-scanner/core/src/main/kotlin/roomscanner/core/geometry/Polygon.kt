package roomscanner.core.geometry

import kotlin.math.abs

/**
 * Polygon helpers. "Positive winding" means positive [signedArea]; with that winding the room
 * interior is on the [Vec2.perpLeft] side of every edge.
 */
object Polygon {
    fun signedArea(pts: List<Vec2>): Double {
        var a = 0.0
        for (i in pts.indices) a += pts[i].cross(pts[(i + 1) % pts.size])
        return a / 2
    }

    fun perimeter(pts: List<Vec2>): Double =
        pts.indices.sumOf { pts[it].distanceTo(pts[(it + 1) % pts.size]) }

    fun centroid(pts: List<Vec2>): Vec2 {
        var x = 0.0
        var z = 0.0
        for (p in pts) { x += p.x; z += p.z }
        return Vec2(x / pts.size, z / pts.size)
    }

    /** True if no two non-adjacent edges touch or cross. */
    fun isSimple(pts: List<Vec2>): Boolean {
        val n = pts.size
        if (n < 3) return false
        for (i in 0 until n) {
            for (j in i + 1 until n) {
                if (j == i + 1 || (i == 0 && j == n - 1)) continue
                if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false
            }
        }
        return true
    }

    fun segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Boolean {
        val d1 = (b - a).cross(c - a)
        val d2 = (b - a).cross(d - a)
        val d3 = (d - c).cross(a - c)
        val d4 = (d - c).cross(b - c)
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
        fun onSeg(p: Vec2, q: Vec2, r: Vec2) =
            r.x >= minOf(p.x, q.x) - EPS && r.x <= maxOf(p.x, q.x) + EPS &&
                r.z >= minOf(p.z, q.z) - EPS && r.z <= maxOf(p.z, q.z) + EPS
        if (abs(d1) < EPS && onSeg(a, b, c)) return true
        if (abs(d2) < EPS && onSeg(a, b, d)) return true
        if (abs(d3) < EPS && onSeg(c, d, a)) return true
        if (abs(d4) < EPS && onSeg(c, d, b)) return true
        return false
    }

    /** Intersection of the infinite lines through (a1, a2) and (b1, b2), or null if parallel. */
    fun lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2? {
        val r = a2 - a1
        val s = b2 - b1
        val denom = r.cross(s)
        if (abs(denom) < 1e-12) return null
        val t = (b1 - a1).cross(s) / denom
        return a1 + r * t
    }

    /**
     * Ear-clipping triangulation of a simple, positively wound polygon.
     * Returns index triples into [pts].
     */
    fun triangulate(pts: List<Vec2>): List<IntArray> {
        require(pts.size >= 3) { "need at least 3 vertices" }
        val idx = pts.indices.toMutableList()
        val out = ArrayList<IntArray>()
        var guard = 0
        while (idx.size > 3 && guard < 10 * pts.size * pts.size) {
            guard++
            var clipped = false
            for (k in idx.indices) {
                val ia = idx[(k + idx.size - 1) % idx.size]
                val ib = idx[k]
                val ic = idx[(k + 1) % idx.size]
                val a = pts[ia]; val b = pts[ib]; val c = pts[ic]
                val turn = (b - a).cross(c - b)
                if (abs(turn) < 1e-12) {          // collinear: drop the vertex, no triangle
                    idx.removeAt(k); clipped = true; break
                }
                if (turn < 0) continue            // reflex
                val blocked = idx.any { j ->
                    j != ia && j != ib && j != ic && pointInTriangle(pts[j], a, b, c)
                }
                if (blocked) continue
                out.add(intArrayOf(ia, ib, ic))
                idx.removeAt(k); clipped = true; break
            }
            if (!clipped) {                       // numerically stuck: force progress
                out.add(intArrayOf(idx[0], idx[1], idx[2]))
                idx.removeAt(1)
            }
        }
        if (idx.size == 3) out.add(intArrayOf(idx[0], idx[1], idx[2]))
        return out
    }

    private fun pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): Boolean {
        val d1 = (b - a).cross(p - a)
        val d2 = (c - b).cross(p - b)
        val d3 = (a - c).cross(p - c)
        return d1 >= -EPS && d2 >= -EPS && d3 >= -EPS
    }

    private const val EPS = 1e-9
}
