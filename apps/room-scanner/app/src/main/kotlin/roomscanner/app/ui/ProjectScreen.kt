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
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import roomscanner.core.geometry.Polygon
import roomscanner.core.model.ExportMode
import roomscanner.core.model.Project
import java.util.Locale
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectScreen(vm: AppViewModel, project: Project) {
    val context = LocalContext.current
    var editingThickness by remember { mutableStateOf(false) }
    BackHandler { vm.screen = Screen.Projects }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(project.name) },
                navigationIcon = { TextButton(onClick = { vm.screen = Screen.Projects }) { Text("Back") } },
            )
        },
    ) { inner ->
        Column(Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState())) {
            if (project.rooms.isEmpty()) {
                Text(
                    "No rooms yet. Scanning works best with the lights on and the floor edges in view.",
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp),
                )
            } else {
                PlanView(project.rooms, Modifier.fillMaxWidth().height(260.dp))
            }
            Button(onClick = { vm.screen = Screen.Capture }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(if (project.rooms.isEmpty()) "Scan a room" else "Scan more rooms")
            }

            if (project.rooms.isNotEmpty()) {
                Text("Rooms", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
                for (room in project.rooms) {
                    Column(Modifier.fillMaxWidth().clickable { vm.screen = Screen.RoomDetail(room.id) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                        Text(room.name, style = MaterialTheme.typography.titleMedium)
                        val area = abs(Polygon.signedArea(room.vertices))
                        Text(
                            String.format(Locale.ROOT, "%.1f m², ceiling %.2f m, %d walls", area, room.height, room.vertices.size),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    HorizontalDivider()
                }

                Text("Export for Blender", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 4.dp))
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(
                        selected = project.settings.exportMode == ExportMode.SOLID,
                        onClick = { vm.update { it.copy(settings = it.settings.copy(exportMode = ExportMode.SOLID)) } },
                        label = { Text("Solid walls") },
                    )
                    FilterChip(
                        selected = project.settings.exportMode == ExportMode.SHELL,
                        onClick = { vm.update { it.copy(settings = it.settings.copy(exportMode = ExportMode.SHELL)) } },
                        label = { Text("Surfaces only") },
                    )
                }
                if (project.settings.exportMode == ExportMode.SOLID) {
                    OutlinedButton(onClick = { editingThickness = true }, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                        Text("Wall thickness: ${metres(project.settings.wallThickness)}")
                    }
                }
                Button(
                    onClick = {
                        try {
                            context.startActivity(vm.store.exportGlb(project))
                        } catch (e: Exception) {
                            Toast.makeText(context, "Could not export: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                ) { Text("Export GLB and send") }
            }
        }
    }

    if (editingThickness) {
        LengthDialog("Wall thickness", "Each room gets its own walls this thick.", project.settings.wallThickness, onDismiss = { editingThickness = false }) { v ->
            editingThickness = false
            vm.update { it.copy(settings = it.settings.copy(wallThickness = v.coerceIn(0.01, 1.0))) }
        }
    }
}
