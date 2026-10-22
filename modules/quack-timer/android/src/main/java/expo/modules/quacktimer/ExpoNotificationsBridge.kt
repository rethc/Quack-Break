package expo.modules.quacktimer

import android.content.Context
import android.os.ResultReceiver
import android.util.Log

/**
 * Cancels reminders booked by expo-notifications. In Expo SDK 58 that library ships prebuilt,
 * so this module can't compile against it; it calls NotificationsService's companion functions
 * by name instead. They're stable public API, and expo-notifications keeps its classes from
 * being renamed in release builds (-keep class expo.modules.notifications.** in its rules).
 */
object ExpoNotificationsBridge {
  private const val TAG = "QuackTimer"
  private const val SERVICE = "expo.modules.notifications.service.NotificationsService"

  private val companion: Any? by lazy {
    runCatching { Class.forName(SERVICE).getField("Companion").get(null) }
      .onFailure { Log.w(TAG, "expo-notifications not found", it) }
      .getOrNull()
  }

  /** Cancel every booked notification. */
  fun removeAll(context: Context) {
    val c = companion ?: return
    runCatching {
      c.javaClass
        .getMethod("removeAllScheduledNotifications", Context::class.java, ResultReceiver::class.java)
        .invoke(c, context, null)
    }.onFailure { Log.w(TAG, "Could not cancel booked notifications", it) }
  }

  /** Cancel the booked notifications with these ids. */
  fun remove(context: Context, ids: Collection<String>) {
    val c = companion ?: return
    runCatching {
      c.javaClass
        .getMethod("removeScheduledNotifications", Context::class.java, Collection::class.java, ResultReceiver::class.java)
        .invoke(c, context, ids, null)
    }.onFailure { Log.w(TAG, "Could not cancel booked notifications", it) }
  }
}
