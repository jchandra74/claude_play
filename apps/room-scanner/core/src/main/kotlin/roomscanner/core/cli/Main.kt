package roomscanner.core.cli

import roomscanner.core.export.GlbWriter
import roomscanner.core.export.ObjWriter
import roomscanner.core.export.ProjectJson
import roomscanner.core.mesh.RoomMesher
import roomscanner.core.model.ExportMode
import java.io.File
import kotlin.system.exitProcess

private const val USAGE = """Usage: plan2glb <plan.json> [-o <out.glb>] [--mode solid|shell] [--thickness <metres>] [--obj]

Turns a room-scanner plan file into a GLB that Blender can import.
  -o           output path (default: the plan's name with .glb)
  --mode       solid = walls with thickness, shell = interior surfaces only (default: from the plan)
  --thickness  wall thickness for solid mode (default: from the plan)
  --obj        also write a Wavefront OBJ next to the GLB"""

fun main(args: Array<String>) {
    var input: String? = null
    var output: String? = null
    var mode: ExportMode? = null
    var thickness: Double? = null
    var obj = false
    var i = 0
    fun value(): String = args.getOrNull(++i) ?: fail("missing value for ${args[i - 1]}")
    while (i < args.size) {
        when (val a = args[i]) {
            "-o" -> output = value()
            "--mode" -> mode = when (value()) {
                "solid" -> ExportMode.SOLID
                "shell" -> ExportMode.SHELL
                else -> fail("--mode must be solid or shell")
            }
            "--thickness" -> thickness = value().toDoubleOrNull() ?: fail("--thickness must be a number")
            "--obj" -> obj = true
            "-h", "--help" -> { println(USAGE); return }
            else -> if (a.startsWith("-") || input != null) fail("unexpected argument: $a") else input = a
        }
        i++
    }
    val inFile = File(input ?: fail("no plan file given"))
    if (!inFile.isFile) fail("no such file: $inFile")

    val project = try {
        ProjectJson.decode(inFile.readText()).normalized()
    } catch (e: Exception) {
        fail("could not read the plan: ${e.message}")
    }
    val useMode = mode ?: project.settings.exportMode
    val mesh = try {
        RoomMesher.mesh(project, useMode, thickness ?: project.settings.wallThickness)
    } catch (e: IllegalArgumentException) {
        fail(e.message ?: "invalid plan")
    }
    mesh.warnings.forEach { System.err.println("warning: $it") }

    val outFile = File(output ?: (inFile.path.removeSuffix(".json") + ".glb"))
    outFile.absoluteFile.parentFile?.mkdirs()
    outFile.writeBytes(GlbWriter.write(mesh, project, useMode))
    val parts = mesh.rooms.sumOf { it.parts.size }
    val tris = mesh.rooms.sumOf { r -> r.parts.sumOf { it.triangleCount } }
    println("wrote $outFile: ${mesh.rooms.size} room(s), $parts objects, $tris triangles")
    if (obj) {
        val objFile = File(outFile.path.removeSuffix(".glb") + ".obj")
        objFile.writeText(ObjWriter.write(mesh))
        println("wrote $objFile")
    }
}

private fun fail(message: String): Nothing {
    System.err.println("error: $message")
    System.err.println(USAGE)
    exitProcess(2)
}
