package roomscanner.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp
import roomscanner.app.AppViewModel
import roomscanner.app.data.StoredProject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectsScreen(vm: AppViewModel) {
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<StoredProject?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Room Scanner") }) },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { creating = true }) { Text("New project") } },
    ) { inner ->
        if (vm.projects.isEmpty()) {
            Column(Modifier.fillMaxSize().padding(inner).padding(24.dp)) {
                Text("No projects yet", style = MaterialTheme.typography.titleMedium)
                Text(
                    "A project is one flat or house. Create one, then scan its rooms.",
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp),
                )
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(inner)) {
                items(vm.projects, key = { it.id }) { p ->
                    Row(
                        Modifier.fillMaxWidth().clickable { vm.open(p) }.padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(p.project.name, style = MaterialTheme.typography.titleMedium)
                            val n = p.project.rooms.size
                            Text(if (n == 1) "1 room" else "$n rooms", style = MaterialTheme.typography.bodySmall)
                        }
                        TextButton(onClick = { deleting = p }) { Text("Delete") }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

    if (creating) {
        TextDialog("New project", "", "Name", "Create", onDismiss = { creating = false }) {
            creating = false
            vm.create(it)
        }
    }
    deleting?.let { p ->
        ConfirmDialog("Delete ${p.project.name}?", "Its rooms will be gone for good.", "Delete", onDismiss = { deleting = null }) {
            deleting = null
            vm.delete(p)
        }
    }
}
