package roomscanner.app.ui

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import java.util.Locale

fun metres(v: Double): String = String.format(Locale.ROOT, "%.2f m", v)

/** Accepts "3.42", "3,42" and "3.42 m". Null if it is not a positive number. */
fun parseMetres(text: String): Double? =
    text.trim().removeSuffix("m").trim().replace(',', '.').toDoubleOrNull()?.takeIf { it > 0 && it.isFinite() }

@Composable
fun TextDialog(title: String, initial: String, label: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text(label) }, singleLine = true) },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onConfirm(text.trim()) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Asks for a length in metres. [onClear], when given, adds a button to remove the value. */
@Composable
fun LengthDialog(title: String, note: String?, initial: Double?, onDismiss: () -> Unit, onClear: (() -> Unit)? = null, onConfirm: (Double) -> Unit) {
    var text by remember { mutableStateOf(initial?.let { String.format(Locale.ROOT, "%.3f", it) } ?: "") }
    val value = parseMetres(text)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = text, onValueChange = { text = it }, label = { Text("Metres") }, singleLine = true,
                supportingText = note?.let { { Text(it) } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
        },
        confirmButton = { TextButton(enabled = value != null, onClick = { onConfirm(value!!) }) { Text("Set") } },
        dismissButton = {
            if (onClear != null) TextButton(onClick = onClear) { Text("Clear") }
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
