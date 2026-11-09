package roomscanner.core.export

import roomscanner.core.mesh.ProjectMesh
import java.util.Locale

/** Wavefront OBJ, as a fallback for tools without glTF import. Metres, Y up. */
object ObjWriter {
    fun write(mesh: ProjectMesh): String {
        val sb = StringBuilder("# room-scanner-core\n")
        var base = 1
        for (room in mesh.rooms) for (part in room.parts) {
            sb.append("o ").append(part.name).append('\n')
            for (i in 0 until part.vertexCount) {
                sb.append(String.format(Locale.ROOT, "v %.5f %.5f %.5f\n", part.positions[3 * i], part.positions[3 * i + 1], part.positions[3 * i + 2]))
            }
            for (i in 0 until part.vertexCount) {
                sb.append(String.format(Locale.ROOT, "vt %.5f %.5f\n", part.uvs[2 * i], part.uvs[2 * i + 1]))
            }
            for (i in 0 until part.vertexCount) {
                sb.append(String.format(Locale.ROOT, "vn %.4f %.4f %.4f\n", part.normals[3 * i], part.normals[3 * i + 1], part.normals[3 * i + 2]))
            }
            for (surface in part.surfaces) {
                sb.append("usemtl ").append(surface.material).append('\n')
                for (t in 0 until surface.indices.size / 3) {
                    sb.append('f')
                    for (k in 0..2) {
                        val v = base + surface.indices[3 * t + k]
                        sb.append(' ').append(v).append('/').append(v).append('/').append(v)
                    }
                    sb.append('\n')
                }
            }
            base += part.vertexCount
        }
        return sb.toString()
    }
}
