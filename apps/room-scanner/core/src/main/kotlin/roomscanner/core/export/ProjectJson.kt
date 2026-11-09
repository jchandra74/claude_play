package roomscanner.core.export

import kotlinx.serialization.json.Json
import roomscanner.core.model.Project

object ProjectJson {
    val format = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encode(project: Project): String = format.encodeToString(Project.serializer(), project)
    fun decode(text: String): Project = format.decodeFromString(Project.serializer(), text)
}
