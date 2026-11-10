package roomscanner.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import roomscanner.app.data.ProjectStore
import roomscanner.app.data.StoredProject
import roomscanner.core.model.Project
import roomscanner.core.model.Room

sealed interface Screen {
    data object Projects : Screen
    data object ProjectDetail : Screen
    data object Capture : Screen
    data class RoomDetail(val roomId: String) : Screen
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    val store = ProjectStore(app)

    var projects by mutableStateOf(store.list())
        private set
    var current by mutableStateOf<StoredProject?>(null)
        private set
    var screen by mutableStateOf<Screen>(Screen.Projects)

    fun create(name: String) {
        current = store.create(name)
        projects = store.list()
        screen = Screen.ProjectDetail
    }

    fun open(p: StoredProject) {
        current = p
        screen = Screen.ProjectDetail
    }

    fun delete(p: StoredProject) {
        store.delete(p.id)
        if (current?.id == p.id) current = null
        projects = store.list()
    }

    fun update(change: (Project) -> Project) {
        val c = current ?: return
        val next = StoredProject(c.id, change(c.project))
        store.save(next)
        current = next
        projects = store.list()
    }

    fun updateRoom(roomId: String, change: (Room) -> Room) = update { p ->
        p.copy(rooms = p.rooms.map { if (it.id == roomId) change(it) else it })
    }
}
