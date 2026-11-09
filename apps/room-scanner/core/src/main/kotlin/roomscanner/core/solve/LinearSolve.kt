package roomscanner.core.solve

import kotlin.math.abs

/** Weighted linear least squares over a small dense system, built row by row. */
internal class LeastSquares(private val n: Int) {
    private val m = Array(n) { DoubleArray(n) }
    private val r = DoubleArray(n)

    /** Adds the equation `sum(coeff * x[index]) = rhs` with the given weight. */
    fun add(indices: IntArray, coeffs: DoubleArray, rhs: Double, weight: Double) {
        for (a in indices.indices) {
            r[indices[a]] += weight * coeffs[a] * rhs
            for (b in indices.indices) m[indices[a]][indices[b]] += weight * coeffs[a] * coeffs[b]
        }
    }

    fun solve(): DoubleArray {
        val a = Array(n) { m[it].copyOf() }
        val b = r.copyOf()
        for (col in 0 until n) {
            var pivot = col
            for (row in col + 1 until n) if (abs(a[row][col]) > abs(a[pivot][col])) pivot = row
            check(abs(a[pivot][col]) > 1e-14) { "singular system" }
            if (pivot != col) {
                val t = a[pivot]; a[pivot] = a[col]; a[col] = t
                val tb = b[pivot]; b[pivot] = b[col]; b[col] = tb
            }
            for (row in col + 1 until n) {
                val f = a[row][col] / a[col][col]
                if (f == 0.0) continue
                for (k in col until n) a[row][k] -= f * a[col][k]
                b[row] -= f * b[col]
            }
        }
        val x = DoubleArray(n)
        for (row in n - 1 downTo 0) {
            var s = b[row]
            for (k in row + 1 until n) s -= a[row][k] * x[k]
            x[row] = s / a[row][row]
        }
        return x
    }
}
