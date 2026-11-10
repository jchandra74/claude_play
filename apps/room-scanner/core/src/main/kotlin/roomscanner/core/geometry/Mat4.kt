package roomscanner.core.geometry

import kotlin.math.abs

/** A 4x4 matrix in column-major order, the layout OpenGL and ARCore use. */
class Mat4(val m: DoubleArray) {
    init { require(m.size == 16) }

    constructor(f: FloatArray) : this(DoubleArray(16) { f[it].toDouble() })

    operator fun times(o: Mat4): Mat4 {
        val r = DoubleArray(16)
        for (c in 0..3) for (row in 0..3) {
            var s = 0.0
            for (k in 0..3) s += m[k * 4 + row] * o.m[c * 4 + k]
            r[c * 4 + row] = s
        }
        return Mat4(r)
    }

    /** Transforms the homogeneous point (x, y, z, w). */
    fun transform(x: Double, y: Double, z: Double, w: Double): DoubleArray = DoubleArray(4) { row ->
        m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row] * w
    }

    /** The inverse, or null if the matrix is singular. */
    fun inverse(): Mat4? {
        val a = Array(4) { r -> DoubleArray(8) { c -> if (c < 4) m[c * 4 + r] else if (c - 4 == r) 1.0 else 0.0 } }
        for (col in 0..3) {
            var pivot = col
            for (r in col + 1..3) if (abs(a[r][col]) > abs(a[pivot][col])) pivot = r
            if (abs(a[pivot][col]) < 1e-14) return null
            val t = a[pivot]; a[pivot] = a[col]; a[col] = t
            val d = a[col][col]
            for (c in 0..7) a[col][c] /= d
            for (r in 0..3) if (r != col) {
                val f = a[r][col]
                if (f != 0.0) for (c in 0..7) a[r][c] -= f * a[col][c]
            }
        }
        return Mat4(DoubleArray(16) { a[it % 4][4 + it / 4] })
    }

    companion object {
        val IDENTITY = Mat4(DoubleArray(16) { if (it % 5 == 0) 1.0 else 0.0 })
    }
}
