package roomscanner.app.ar

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableApkTooOldException
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException
import com.google.ar.core.exceptions.UnavailableDeviceNotCompatibleException
import com.google.ar.core.exceptions.UnavailableSdkTooOldException
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException

/** Owns the ARCore session for one visit to the capture screen. Main thread only, except [session]. */
class ArController(private val activity: Activity) {

    /** Read by the GL thread every frame. */
    @Volatile
    var session: Session? = null
        private set

    private var installRequested = false

    val hasCameraPermission: Boolean
        get() = ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    /**
     * Starts or restarts the camera. Returns null when running (or when ARCore's own install
     * prompt has taken over and will bring us back here), otherwise a message for the user.
     */
    fun resume(): String? {
        if (!hasCameraPermission) return "Camera permission is needed to scan"
        try {
            if (session == null) {
                when (ArCoreApk.getInstance().requestInstall(activity, !installRequested)) {
                    ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
                        installRequested = true
                        return null
                    }
                    else -> Unit
                }
                val s = Session(activity)
                s.configure(Config(s).apply {
                    planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                    focusMode = Config.FocusMode.AUTO
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                    lightEstimationMode = Config.LightEstimationMode.DISABLED
                    depthMode = Config.DepthMode.DISABLED // taps intersect known planes; depth is not needed yet
                })
                session = s
            }
            session?.resume()
            return null
        } catch (e: UnavailableArcoreNotInstalledException) {
            return "Google Play Services for AR is not installed"
        } catch (e: UnavailableUserDeclinedInstallationException) {
            return "Google Play Services for AR is needed to scan"
        } catch (e: UnavailableApkTooOldException) {
            return "Update Google Play Services for AR, then try again"
        } catch (e: UnavailableSdkTooOldException) {
            return "This app is too old for the installed AR services"
        } catch (e: UnavailableDeviceNotCompatibleException) {
            return "This device does not support AR"
        } catch (e: CameraNotAvailableException) {
            session = null
            return "The camera is in use by another app"
        } catch (e: Exception) {
            return "Could not start AR: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    fun pause() {
        session?.pause()
    }

    /** Call after the GL view has been paused, so no frame is in flight. */
    fun close() {
        val s = session
        session = null
        s?.close()
    }
}
