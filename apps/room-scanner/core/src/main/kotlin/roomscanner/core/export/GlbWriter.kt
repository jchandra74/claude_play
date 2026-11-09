package roomscanner.core.export

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import roomscanner.core.mesh.Category
import roomscanner.core.mesh.ProjectMesh
import roomscanner.core.model.ExportMode
import roomscanner.core.model.Project
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Writes binary glTF 2.0: metres, Y up, right-handed. Blender's importer converts to its own
 * Z-up frame, so the model arrives upright at 1:1 scale.
 *
 * Node tree: project > room > one node per wall, floor and ceiling. When [plan] is given it is
 * stored in the project node's `extras`, so the file carries its own editable source.
 */
object GlbWriter {

    fun write(mesh: ProjectMesh, plan: Project? = null, mode: ExportMode = plan?.settings?.exportMode ?: ExportMode.SOLID): ByteArray {
        val bin = ByteArrayOutputStream()
        val bufferViews = ArrayList<JsonObject>()
        val accessors = ArrayList<JsonObject>()
        val meshes = ArrayList<JsonObject>()
        val nodes = ArrayList<JsonObject?>()

        fun view(bytes: ByteArray, target: Int): Int {
            val offset = bin.size()
            bin.write(bytes)
            while (bin.size() % 4 != 0) bin.write(0)
            bufferViews += buildJsonObject {
                put("buffer", 0); put("byteOffset", offset); put("byteLength", bytes.size); put("target", target)
            }
            return bufferViews.size - 1
        }

        fun vec3Accessor(data: FloatArray, withBounds: Boolean): Int {
            val bytes = ByteBuffer.allocate(data.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            data.forEach { bytes.putFloat(it) }
            val v = view(bytes.array(), ARRAY_BUFFER)
            accessors += buildJsonObject {
                put("bufferView", v); put("componentType", FLOAT); put("count", data.size / 3); put("type", "VEC3")
                if (withBounds) {
                    val min = FloatArray(3) { Float.POSITIVE_INFINITY }
                    val max = FloatArray(3) { Float.NEGATIVE_INFINITY }
                    for (i in data.indices) {
                        min[i % 3] = minOf(min[i % 3], data[i]); max[i % 3] = maxOf(max[i % 3], data[i])
                    }
                    putJsonArray("min") { min.forEach { add(it) } }
                    putJsonArray("max") { max.forEach { add(it) } }
                }
            }
            return accessors.size - 1
        }

        fun indexAccessor(data: IntArray): Int {
            val bytes = ByteBuffer.allocate(data.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            data.forEach { bytes.putInt(it) }
            val v = view(bytes.array(), ELEMENT_ARRAY_BUFFER)
            accessors += buildJsonObject {
                put("bufferView", v); put("componentType", UNSIGNED_INT); put("count", data.size); put("type", "SCALAR")
            }
            return accessors.size - 1
        }

        nodes += null // project node, filled in once its children are known
        val roomNodes = ArrayList<Int>()
        for (room in mesh.rooms) {
            val children = ArrayList<Int>()
            for (part in room.parts) {
                if (part.indices.isEmpty()) continue
                val p = vec3Accessor(part.positions, withBounds = true)
                val n = vec3Accessor(part.normals, withBounds = false)
                val i = indexAccessor(part.indices)
                meshes += buildJsonObject {
                    put("name", part.name)
                    putJsonArray("primitives") {
                        add(buildJsonObject {
                            putJsonObject("attributes") { put("POSITION", p); put("NORMAL", n) }
                            put("indices", i); put("material", part.category.ordinal); put("mode", TRIANGLES)
                        })
                    }
                }
                nodes += buildJsonObject { put("name", part.name); put("mesh", meshes.size - 1) }
                children += nodes.size - 1
            }
            nodes += buildJsonObject {
                put("name", room.name)
                if (children.isNotEmpty()) put("children", intArray(children))
            }
            roomNodes += nodes.size - 1
        }
        nodes[0] = buildJsonObject {
            put("name", mesh.name.ifBlank { "Project" })
            if (roomNodes.isNotEmpty()) put("children", intArray(roomNodes))
            if (plan != null) putJsonObject("extras") {
                put("roomScannerPlan", ProjectJson.format.encodeToJsonElement(Project.serializer(), plan))
            }
        }

        val binBytes = bin.toByteArray()
        val gltf = buildJsonObject {
            putJsonObject("asset") { put("version", "2.0"); put("generator", "room-scanner-core") }
            put("scene", 0)
            putJsonArray("scenes") { add(buildJsonObject { putJsonArray("nodes") { add(0) } }) }
            put("nodes", JsonArray(nodes.map { it!! }))
            if (meshes.isNotEmpty()) {
                put("meshes", JsonArray(meshes))
                put("materials", materials(mode))
                put("accessors", JsonArray(accessors))
                put("bufferViews", JsonArray(bufferViews))
                putJsonArray("buffers") { add(buildJsonObject { put("byteLength", binBytes.size) }) }
            }
        }

        var json = gltf.toString().toByteArray(Charsets.UTF_8)
        if (json.size % 4 != 0) json += ByteArray(4 - json.size % 4) { ' '.code.toByte() }
        val hasBin = binBytes.isNotEmpty()
        val total = 12 + 8 + json.size + if (hasBin) 8 + binBytes.size else 0
        val out = ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN)
        out.putInt(MAGIC).putInt(2).putInt(total)
        out.putInt(json.size).putInt(CHUNK_JSON).put(json)
        if (hasBin) out.putInt(binBytes.size).putInt(CHUNK_BIN).put(binBytes)
        return out.array()
    }

    /** One material per [Category], indexed by its ordinal. */
    private fun materials(mode: ExportMode) = buildJsonArray {
        fun material(name: String, r: Double, g: Double, b: Double, doubleSided: Boolean) = add(buildJsonObject {
            put("name", name)
            putJsonObject("pbrMetallicRoughness") {
                putJsonArray("baseColorFactor") { add(r); add(g); add(b); add(1.0) }
                put("metallicFactor", 0.0); put("roughnessFactor", 0.9)
            }
            if (doubleSided) put("doubleSided", true)
        })
        material("Wall", 0.85, 0.85, 0.82, doubleSided = mode == ExportMode.SHELL)
        material("Floor", 0.55, 0.45, 0.35, doubleSided = true)
        material("Ceiling", 0.95, 0.95, 0.95, doubleSided = true)
    }

    private fun intArray(values: List<Int>) = JsonArray(values.map { JsonPrimitive(it) })

    private const val MAGIC = 0x46546C67
    private const val CHUNK_JSON = 0x4E4F534A
    private const val CHUNK_BIN = 0x004E4942
    private const val FLOAT = 5126
    private const val UNSIGNED_INT = 5125
    private const val ARRAY_BUFFER = 34962
    private const val ELEMENT_ARRAY_BUFFER = 34963
    private const val TRIANGLES = 4
}
