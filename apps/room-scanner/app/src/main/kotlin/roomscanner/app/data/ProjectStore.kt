package roomscanner.app.data

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import roomscanner.core.export.GlbWriter
import roomscanner.core.export.ProjectJson
import roomscanner.core.mesh.RoomMesher
import roomscanner.core.model.Project
import java.io.File
import java.util.UUID

class StoredProject(val id: String, val project: Project)

/** Projects are plan JSON files in the app's private storage, one per project. */
class ProjectStore(private val context: Context) {
    private val dir = File(context.filesDir, "projects").apply { mkdirs() }

    fun list(): List<StoredProject> =
        (dir.listFiles { f -> f.extension == "json" } ?: emptyArray())
            .sortedByDescending { it.lastModified() }
            .mapNotNull { f -> runCatching { StoredProject(f.nameWithoutExtension, ProjectJson.decode(f.readText())) }.getOrNull() }

    fun create(name: String): StoredProject = StoredProject(UUID.randomUUID().toString(), Project(name = name)).also { save(it) }

    fun save(p: StoredProject) {
        // Write beside the target and rename, so a crash mid-write cannot corrupt a project.
        val tmp = File(dir, "${p.id}.tmp")
        tmp.writeText(ProjectJson.encode(p.project))
        tmp.renameTo(File(dir, "${p.id}.json"))
    }

    fun delete(id: String) {
        File(dir, "$id.json").delete()
    }

    /**
     * Writes the project as a GLB and returns a share intent for it.
     * @throws IllegalArgumentException with a readable message if the plan cannot be meshed.
     */
    fun exportGlb(project: Project): Intent {
        val mesh = RoomMesher.mesh(project)
        val out = File(context.cacheDir, "exports").apply { mkdirs() }
        val safe = project.name.replace(Regex("[^A-Za-z0-9._-]+"), "_").trim('_').ifEmpty { "rooms" }
        val file = File(out, "$safe.glb")
        file.writeBytes(GlbWriter.write(mesh, project.normalized()))
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, file.name)
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return Intent.createChooser(send, "Send ${file.name}")
    }
}
