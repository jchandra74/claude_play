package roomscanner.app.ar

import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.util.Log
import com.google.ar.core.Camera
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingFailureReason
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.SessionPausedException
import roomscanner.core.geometry.Mat4
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/** What the UI needs to know about one camera frame. */
class ArFrameState(
    val tracking: Boolean,
    /** Why tracking is not working, when it is not. */
    val problem: String?,
    val viewProjection: Mat4,
    val width: Int,
    val height: Int,
    /** World height of the detected floor, once one has been found. */
    val floorY: Double?,
    val cameraY: Double,
)

/**
 * Runs the ARCore frame loop on the GL thread: draws the camera image and reports the camera's
 * pose and the floor to [onFrame]. Everything else is drawn by the UI on top.
 */
class ArRenderer(
    private val controller: ArController,
    private val displayRotation: () -> Int,
    private val onFrame: (ArFrameState) -> Unit,
) : GLSurfaceView.Renderer {

    private val background = BackgroundRenderer()
    private var width = 1
    private var height = 1
    private var appliedRotation = -1
    private var geometryDirty = true
    private var textureSession: Session? = null
    private val view = FloatArray(16)
    private val projection = FloatArray(16)

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        background.create()
        textureSession = null
        geometryDirty = true
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        GLES20.glViewport(0, 0, w, h)
        width = w
        height = h
        geometryDirty = true
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val session = controller.session ?: return
        try {
            if (textureSession !== session) {
                session.setCameraTextureName(background.textureId)
                textureSession = session
                geometryDirty = true
            }
            val rotation = displayRotation()
            if (geometryDirty || rotation != appliedRotation) {
                session.setDisplayGeometry(rotation, width, height)
                appliedRotation = rotation
                geometryDirty = false
            }
            val frame = session.update()
            background.draw(frame)

            val camera = frame.camera
            camera.getViewMatrix(view, 0)
            camera.getProjectionMatrix(projection, 0, 0.05f, 60f)
            val tracking = camera.trackingState == TrackingState.TRACKING
            val cameraY = camera.pose.ty().toDouble()
            onFrame(
                ArFrameState(
                    tracking = tracking,
                    problem = if (tracking) null else problem(camera),
                    viewProjection = Mat4(projection) * Mat4(view),
                    width = width,
                    height = height,
                    floorY = if (tracking) findFloor(session, cameraY) else null,
                    cameraY = cameraY,
                )
            )
        } catch (e: SessionPausedException) {
            // Between pause and resume; nothing to draw.
        } catch (t: Throwable) {
            Log.e("RoomScanner", "frame failed", t)
        }
    }

    /** The floor is taken to be the lowest sizeable upward-facing plane well below the phone. */
    private fun findFloor(session: Session, cameraY: Double): Double? {
        var best: Double? = null
        for (plane in session.getAllTrackables(Plane::class.java)) {
            if (plane.trackingState != TrackingState.TRACKING || plane.subsumedBy != null) continue
            if (plane.type != Plane.Type.HORIZONTAL_UPWARD_FACING) continue
            if (plane.extentX * plane.extentZ < 0.3f) continue
            val y = plane.centerPose.ty().toDouble()
            if (y > cameraY - 0.4) continue
            if (best == null || y < best) best = y
        }
        return best
    }

    private fun problem(camera: Camera): String = when (camera.trackingFailureReason) {
        TrackingFailureReason.INSUFFICIENT_LIGHT -> "Too dark to track. Turn on more lights"
        TrackingFailureReason.EXCESSIVE_MOTION -> "Moving too fast. Slow down"
        TrackingFailureReason.INSUFFICIENT_FEATURES -> "Not enough detail here. Point at something less plain"
        TrackingFailureReason.CAMERA_UNAVAILABLE -> "The camera is in use by another app"
        else -> "Move the phone slowly from side to side"
    }
}
