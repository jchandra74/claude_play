package roomscanner.app.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import roomscanner.app.AppViewModel
import roomscanner.app.Screen

@Composable
fun App(vm: AppViewModel = viewModel()) {
    val project = vm.current
    val screen = vm.screen
    val room = (screen as? Screen.RoomDetail)?.let { s -> project?.project?.rooms?.firstOrNull { it.id == s.roomId } }
    when {
        project == null || screen == Screen.Projects -> ProjectsScreen(vm)
        screen == Screen.Capture -> CaptureScreen(
            project = project.project,
            onRoomScanned = { scanned -> vm.update { it.copy(rooms = it.rooms + scanned) } },
            onDone = { vm.screen = Screen.ProjectDetail },
        )
        room != null -> RoomScreen(vm, project.project, room)
        else -> ProjectScreen(vm, project.project) // also where a deleted room's screen falls back to
    }
}
