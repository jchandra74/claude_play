package roomscanner.app.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.opengl.GLSurfaceView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import roomscanner.app.ar.ArController
import roomscanner.app.ar.ArFrameState
import roomscanner.app.ar.ArRenderer
import roomscanner.core.capture.Aim
import roomscanner.core.capture.CaptureStep
import roomscanner.core.capture.LineStyle
import roomscanner.core.capture.Overlay
import roomscanner.core.capture.Projector
import roomscanner.core.capture.RoomCapture
import roomscanner.core.geometry.Vec3
import roomscanner.core.model.OpeningType
import roomscanner.core.model.Pose2
import roomscanner.core.model.Project
import roomscanner.core.model.Room
import roomscanner.core.solve.RoomEditor
import java.util.UUID
import kotlin.math.floor

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * The AR scan. The camera image is drawn by OpenGL; the guides are drawn on top by projecting
 * the capture's 3D lines with the frame's camera matrices.
 *
 * Rooms scanned in one visit share the AR session's coordinate frame, so they keep their true
 * positions relative to each other.
 */
@Composable
fun CaptureScreen(project: Project, onRoomScanned: (Room) -> Unit, onDone: () -> Unit) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    if (activity == null) {
        LaunchedEffect(Unit) { onDone() }
        return
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    val controller = remember { ArController(activity) }

    var frame by remember { mutableStateOf<ArFrameState?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var capture by remember { mutableStateOf<RoomCapture?>(null) }
    var revision by remember { mutableIntStateOf(0) } // RoomCapture is mutable; bump to redraw
    var notice by remember { mutableStateOf<String?>(null) }
    var scanned by remember { mutableIntStateOf(0) }
    var sessionOrigin by remember { mutableStateOf<Pose2?>(null) }
    var angleSnap by remember { mutableStateOf(true) }
    var openingType by remember { mutableStateOf(OpeningType.DOOR) }
    var resumed by remember { mutableStateOf(false) }
    var permissionAsked by remember { mutableStateOf(false) }

    val glView = remember {
        GLSurfaceView(activity).apply {
            preserveEGLContextOnPause = true
            setEGLContextClientVersion(2)
            setEGLConfigChooser(8, 8, 8, 8, 16, 0)
            setRenderer(ArRenderer(controller, displayRotation = { display?.rotation ?: 0 }, onFrame = { state -> post { frame = state } }))
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            keepScreenOn = true
        }
    }

    fun start() {
        error = controller.resume()
        if (error == null) glView.onResume()
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && resumed) start() else if (!granted) error = "Camera permission is needed to scan"
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    resumed = true
                    when {
                        controller.hasCameraPermission -> start()
                        // Ask once per visit: the system dialog pauses and resumes us, which would loop.
                        !permissionAsked -> { permissionAsked = true; permission.launch(Manifest.permission.CAMERA) }
                        else -> error = "Camera permission is needed to scan. Allow it in the phone's settings for this app."
                    }
                }
                Lifecycle.Event.ON_PAUSE -> {
                    resumed = false
                    glView.onPause()
                    controller.pause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            glView.onPause()
            controller.pause()
            controller.close()
        }
    }
    BackHandler { onDone() }

    val state = frame
    val projector = state?.takeIf { it.tracking }?.let { Projector(it.viewProjection, it.width, it.height) }
    val ray = projector?.ray()
    // Reading `revision` here makes taps and undo recompute the aim.
    val aim: Aim? = revision.let { capture?.let { c -> ray?.let { c.aim(it) } } }
    val floorY = capture?.floorY ?: state?.floorY

    fun finishRoom(c: RoomCapture) {
        val number = project.rooms.size + 1
        var room = c.toRoom(UUID.randomUUID().toString(), "Room $number")
        // The first room of this session decides where the session's frame sits in the project.
        val origin = sessionOrigin ?: RoomEditor.placeBeside(project, listOf(room))[0].origin.also { sessionOrigin = it }
        room = room.copy(origin = origin)
        onRoomScanned(room)
        scanned++
        capture = null
        notice = "${room.name} saved. Walk to the next room, or press Done."
    }

    fun tap() {
        val r = ray ?: return
        val y = floorY ?: return
        val c = capture ?: RoomCapture(y).also { it.angleSnap = angleSnap; it.openingType = openingType; capture = it }
        notice = c.tap(r)
        revision++
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(factory = { glView }, modifier = Modifier.fillMaxSize())

        Canvas(Modifier.fillMaxSize()) {
            val p = projector ?: return@Canvas
            fun line(a: Vec3, b: Vec3, color: Color, width: Float) {
                val s = p.project(a, b) ?: return
                drawLine(color, Offset(s.a.x, s.a.y), Offset(s.b.x, s.b.y), strokeWidth = width, cap = StrokeCap.Round)
            }
            val c = capture
            // A floor grid under the reticle shows where the app thinks the floor is.
            if (floorY != null && ray != null && (c == null || c.step == CaptureStep.CORNERS)) {
                val t = (floorY - ray.origin.y) / ray.dir.y
                if (ray.dir.y < -0.05 && t > 0 && t < 8) {
                    val cx = floor((ray.origin.x + ray.dir.x * t) / GRID) * GRID
                    val cz = floor((ray.origin.z + ray.dir.z * t) / GRID) * GRID
                    val grid = Color(0x55FFFFFF)
                    for (k in -3..4) {
                        line(Vec3(cx + k * GRID, floorY, cz - 3 * GRID), Vec3(cx + k * GRID, floorY, cz + 4 * GRID), grid, 1.dp.toPx())
                        line(Vec3(cx - 3 * GRID, floorY, cz + k * GRID), Vec3(cx + 4 * GRID, floorY, cz + k * GRID), grid, 1.dp.toPx())
                    }
                }
            }
            if (c != null) {
                for (l in Overlay.lines(c, aim)) {
                    val color = when (l.style) {
                        LineStyle.WALL -> Color.White
                        LineStyle.GUIDE -> Color(0xFF7FE0D4)
                        LineStyle.GUIDE_WARN -> Color(0xFFFFB020)
                        LineStyle.CLOSE -> Color(0xFF6BE675)
                        LineStyle.HIGHLIGHT -> Color(0xFF7FE0D4)
                        LineStyle.OPENING -> Color(0xFFFFC857)
                        LineStyle.PENDING -> Color(0xFFFF8A65)
                    }
                    line(l.a, l.b, color, 3.dp.toPx())
                }
                Overlay.target(c, aim)?.let { t -> p.project(t)?.let { drawCircle(Color.White, 5.dp.toPx(), Offset(it.x, it.y)) } }
            }
            // The reticle: what a tap acts on.
            val centre = Offset(size.width / 2, size.height / 2)
            val usable = if (c == null) floorY != null else aim?.valid == true
            val reticle = when {
                !usable -> Color(0xFFFF6B6B)
                aim?.wouldClose == true -> Color(0xFF6BE675)
                aim != null && !aim.reliable -> Color(0xFFFFB020)
                else -> Color.White
            }
            drawCircle(reticle, 14.dp.toPx(), centre, style = Stroke(2.dp.toPx()))
            drawCircle(reticle, 2.dp.toPx(), centre)
        }

        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
            // Top: what to do now.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                val c = capture
                val instruction = when {
                    error != null -> error!!
                    state == null -> "Starting the camera"
                    !state.tracking -> state.problem ?: "Move the phone slowly"
                    floorY == null -> "Point the phone at the floor and move it slowly until a grid appears"
                    c == null -> "Aim the circle at a corner where a wall meets the floor, then mark it. Go round the room in order."
                    c.step == CaptureStep.CORNERS && aim?.wouldClose == true -> "Back at the first corner. Close the room."
                    c.step == CaptureStep.CORNERS && aim != null && !aim.reliable -> "Too far or too shallow to be accurate. Step closer to the corner."
                    c.step == CaptureStep.CORNERS && c.corners.size < 3 -> "Mark the next corner. Corner ${c.corners.size + 1}."
                    c.step == CaptureStep.CORNERS -> "Mark the next corner, or aim at the first one to close the room."
                    c.step == CaptureStep.HEIGHT -> "Aim at the line where any wall meets the ceiling, then set the height."
                    c.pendingOpening != null -> "Now aim at the opposite corner of the ${openingType.label()}."
                    else -> "Optional: aim at one corner of a door or window and mark it. Finish when done."
                }
                Column(Modifier.weight(1f).background(Color(0xB3000000), RoundedCornerShape(12.dp)).padding(12.dp)) {
                    Text(instruction, color = Color.White, style = MaterialTheme.typography.bodyLarge)
                    val detail = when {
                        notice != null -> notice
                        c == null && floorY != null && state != null -> "Floor found ${metres(state.cameraY - floorY)} below the phone"
                        c?.step == CaptureStep.CORNERS && aim?.segmentLength != null -> "This wall: ${metres(aim.segmentLength!!)}"
                        c?.step == CaptureStep.HEIGHT && aim?.height != null -> "Ceiling: ${metres(aim.height!!)}"
                        c?.step == CaptureStep.HEIGHT -> c.solve?.closureGap?.let { "Room closed within ${"%.0f".format(it * 100)} cm" }
                        else -> null
                    }
                    if (detail != null) Text(detail, color = Color(0xFF7FE0D4), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                }
                FilledTonalButton(onClick = onDone) { Text(if (scanned > 0) "Done ($scanned)" else "Close") }
            }

            // Bottom: the actions for this step.
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                val c = capture
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (c == null || c.step == CaptureStep.CORNERS) {
                        FilterChip(selected = angleSnap, onClick = { angleSnap = !angleSnap; c?.angleSnap = angleSnap; revision++ }, label = { Text("Snap to right angles") })
                    }
                    if (c?.step == CaptureStep.OPENINGS) {
                        for (type in OpeningType.entries) {
                            FilterChip(selected = openingType == type, onClick = { openingType = type; c.openingType = type; revision++ }, label = { Text(type.label().replaceFirstChar(Char::uppercaseChar)) })
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledTonalButton(enabled = c?.canUndo == true, onClick = { c?.undo(); if (c?.canUndo == false) capture = null; notice = null; revision++ }) { Text("Undo") }
                    val label = when {
                        c == null || c.step == CaptureStep.CORNERS -> if (aim?.wouldClose == true) "Close room" else "Mark corner"
                        c.step == CaptureStep.HEIGHT -> "Set height"
                        else -> "Mark ${openingType.label()} corner"
                    }
                    val enabled = error == null && ray != null && (if (c == null) floorY != null else aim?.valid == true)
                    Button(enabled = enabled, onClick = { tap() }, modifier = Modifier.weight(1f)) { Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(vertical = 8.dp)) }
                    if (c?.step == CaptureStep.OPENINGS) {
                        Button(onClick = { finishRoom(c); revision++ }) { Text("Finish room") }
                    }
                }
            }
        }
    }
}

private fun OpeningType.label() = if (this == OpeningType.DOOR) "door" else "window"

private const val GRID = 0.5
