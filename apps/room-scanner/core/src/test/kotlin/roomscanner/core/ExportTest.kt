package roomscanner.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import roomscanner.core.export.GlbWriter
import roomscanner.core.export.ObjWriter
import roomscanner.core.export.ProjectJson
import roomscanner.core.mesh.RoomMesher
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExportTest {
    private val plan = ProjectJson.decode(File("../samples/two-rooms.json").readText()).normalized()
    private val mesh = RoomMesher.mesh(plan)

    private class Glb(val json: JsonObject, val bin: ByteArray)

    private fun parse(bytes: ByteArray): Glb {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(0x46546C67, b.int, "magic")
        assertEquals(2, b.int, "version")
        assertEquals(bytes.size, b.int, "declared length")
        val jsonLen = b.int
        assertEquals(0x4E4F534A, b.int)
        assertEquals(0, jsonLen % 4)
        val json = ByteArray(jsonLen).also { b.get(it) }
        val binLen = b.int
        assertEquals(0x004E4942, b.int)
        assertEquals(0, binLen % 4)
        val bin = ByteArray(binLen).also { b.get(it) }
        assertEquals(0, b.remaining())
        return Glb(Json.parseToJsonElement(String(json)).jsonObject, bin)
    }

    @Test fun `glb is well formed and every accessor fits the buffer`() {
        val glb = parse(GlbWriter.write(mesh, plan))
        val g = glb.json
        assertEquals("2.0", g["asset"]!!.jsonObject["version"]!!.jsonPrimitive.content)
        assertEquals(glb.bin.size, g["buffers"]!!.jsonArray[0].jsonObject["byteLength"]!!.jsonPrimitive.int)
        val views = g["bufferViews"]!!.jsonArray
        for (a in g["accessors"]!!.jsonArray) {
            val acc = a.jsonObject
            val view = views[acc["bufferView"]!!.jsonPrimitive.int].jsonObject
            val width = if (acc["type"]!!.jsonPrimitive.content == "VEC3") 12 else 4
            assertEquals(acc["count"]!!.jsonPrimitive.int * width, view["byteLength"]!!.jsonPrimitive.int)
            assertTrue(view["byteOffset"]!!.jsonPrimitive.int + view["byteLength"]!!.jsonPrimitive.int <= glb.bin.size)
            assertEquals(0, view["byteOffset"]!!.jsonPrimitive.int % 4)
        }
    }

    @Test fun `glb carries named objects, real-world bounds and the plan`() {
        val g = parse(GlbWriter.write(mesh, plan)).json
        val nodes = g["nodes"]!!.jsonArray.map { it.jsonObject }
        val names = nodes.map { it["name"]!!.jsonPrimitive.content }
        assertEquals("Sample flat", names[0])
        assertTrue(names.containsAll(listOf("LivingRoom", "Bedroom", "LivingRoom_Wall_01", "LivingRoom_Wall_06", "LivingRoom_Floor", "Bedroom_Wall_04", "Bedroom_Ceiling")))
        assertEquals(6 + 2 + 4 + 2, g["meshes"]!!.jsonArray.size)

        val bounded = g["accessors"]!!.jsonArray.map { it.jsonObject }.filter { "min" in it }
        fun lo(axis: Int) = bounded.minOf { it["min"]!!.jsonArray[axis].jsonPrimitive.float }
        fun hi(axis: Int) = bounded.maxOf { it["max"]!!.jsonArray[axis].jsonPrimitive.float }
        // Living room 5 x 5.5, bedroom 3.5 wide starting at x = 5.2, 0.1 walls all round, 2.4 high.
        assertEquals(-0.1f, lo(0), 1e-5f); assertEquals(8.8f, hi(0), 1e-5f)
        assertEquals(0f, lo(1), 1e-5f); assertEquals(2.4f, hi(1), 1e-5f)
        assertEquals(-0.1f, lo(2), 1e-5f); assertEquals(5.6f, hi(2), 1e-5f)

        val embedded = nodes[0]["extras"]!!.jsonObject["roomScannerPlan"]!!
        assertEquals(plan, ProjectJson.format.decodeFromJsonElement(roomscanner.core.model.Project.serializer(), embedded))
    }

    @Test fun `obj lists every object and face`() {
        val obj = ObjWriter.write(mesh)
        val lines = obj.lines()
        assertEquals(14, lines.count { it.startsWith("o ") })
        assertEquals(mesh.rooms.sumOf { r -> r.parts.sumOf { it.triangleCount } }, lines.count { it.startsWith("f ") })
        assertEquals(mesh.rooms.sumOf { r -> r.parts.sumOf { it.vertexCount } }, lines.count { it.startsWith("v ") })
    }
}
