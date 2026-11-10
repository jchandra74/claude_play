package roomscanner.app.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import roomscanner.app.AppViewModel
import roomscanner.app.Screen
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Project
import roomscanner.core.model.Room
import roomscanner.core.solve.RoomEditor

/** Review of one room: its outline with every wall length, and corrections from a tape measure. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(vm: AppViewModel, project: Project, room: Room) {
    val context = LocalContext.current
    var wall by remember { mutableStateOf<Int?>(null) }
    var editingWall by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var editingHeight by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    BackHandler { vm.screen = Screen.ProjectDetail }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(room.name) },
                navigationIcon = { TextButton(onClick = { vm.screen = Screen.ProjectDetail }) { Text("Back") } },
                actions = { TextButton(onClick = { deleting = true }) { Text("Delete") } },
            )
        },
    ) { inner ->
        Column(Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState())) {
            PlanView(listOf(room), Modifier.fillMaxWidth().height(300.dp), selectedWall = wall, showLengths = true)
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { renaming = true }) { Text("Rename") }
                OutlinedButton(onClick = { editingHeight = true }) { Text("Ceiling: ${metres(room.height)}") }
            }
            Text("Walls", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 16.dp, top = 16.dp))
            Text(
                "Tap a wall to enter its length from a tape measure. The room is adjusted to match.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            room.walls.forEachIndexed { i, w ->
                Row(
                    Modifier.fillMaxWidth().clickable { wall = i; editingWall = true }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Wall ${i + 1}", style = MaterialTheme.typography.titleMedium)
                        val doors = w.openings.count { it.type == OpeningType.DOOR }
                        val windows = w.openings.count { it.type == OpeningType.WINDOW }
                        val parts = listOfNotNull(
                            if (w.lockedLength != null) "measured" else "from scan",
                            if (doors > 0) "$doors door${if (doors > 1) "s" else ""}" else null,
                            if (windows > 0) "$windows window${if (windows > 1) "s" else ""}" else null,
                        )
                        Text(parts.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                    }
                    Text(metres(room.wallLength(i)), style = MaterialTheme.typography.titleMedium)
                }
                HorizontalDivider()
            }
        }
    }

    fun setLength(index: Int, length: Double?) {
        val (updated, warnings) = RoomEditor.setWallLength(room, index, length)
        if (updated === room && warnings.isNotEmpty()) {
            Toast.makeText(context, "That length does not fit the rest of the room", Toast.LENGTH_LONG).show()
            return
        }
        vm.updateRoom(room.id) { updated }
        warnings.firstOrNull()?.let { Toast.makeText(context, it.replaceFirstChar(Char::uppercaseChar), Toast.LENGTH_LONG).show() }
    }

    val selected = wall
    if (editingWall && selected != null && selected < room.walls.size) {
        val locked = room.walls[selected].lockedLength
        LengthDialog(
            title = "Wall ${selected + 1}",
            note = "Scanned as ${metres(room.wallLength(selected))}",
            initial = locked ?: room.wallLength(selected),
            onDismiss = { editingWall = false },
            onClear = if (locked != null) ({ editingWall = false; setLength(selected, null) }) else null,
        ) { v -> editingWall = false; setLength(selected, v) }
    }
    if (renaming) {
        TextDialog("Rename room", room.name, "Name", "Rename", onDismiss = { renaming = false }) { name ->
            renaming = false
            vm.updateRoom(room.id) { it.copy(name = name) }
        }
    }
    if (editingHeight) {
        LengthDialog("Ceiling height", null, room.height, onDismiss = { editingHeight = false }) { v ->
            editingHeight = false
            vm.updateRoom(room.id) { it.copy(height = v.coerceIn(1.0, 10.0)) }
        }
    }
    if (deleting) {
        ConfirmDialog("Delete ${room.name}?", "The room will be removed from ${project.name}.", "Delete", onDismiss = { deleting = false }) {
            deleting = false
            vm.update { p -> p.copy(rooms = p.rooms.filter { it.id != room.id }) }
            vm.screen = Screen.ProjectDetail
        }
    }
}
