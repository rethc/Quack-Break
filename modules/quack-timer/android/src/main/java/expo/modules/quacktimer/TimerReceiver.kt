package expo.modules.quacktimer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the notification's buttons, the timer's own alarms, and re-showing the timer after a
 * reboot or an app update. A clock or time-zone change, or exact alarms being allowed, also
 * re-runs the app's sync so reminders are rebooked. Works without the app's JS running.
 */
class TimerReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_RENDER = "expo.modules.quacktimer.RENDER"
    const val ACTION_STOP = "expo.modules.quacktimer.STOP"
    const val ACTION_END_BREAK = "expo.modules.quacktimer.END_BREAK"
    const val ACTION_RESUME = "expo.modules.quacktimer.RESUME"
    const val ACTION_REFILL = "expo.modules.quacktimer.REFILL"
    private const val EXACT_ALARM_CHANGED = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_STOP -> {
        // Stop reminders: cancel everything expo-notifications has booked, then show
        // "Reminders stopped" with Resume.
        ExpoNotificationsBridge.removeAll(context)
        TimerStore.plan(context)?.let {
          TimerStore.savePlan(
            context,
            it.copy(paused = true, breakEndsAt = 0, overId = "", reminders = emptyList(), refillAt = 0),
          )
        }
        TimerStore.addAction(context, "stop")
        TimerRenderer.render(context)
        TimerEvents.listener?.invoke()
      }
      ACTION_RESUME -> {
        // The app's sync books the reminders again and brings the countdown back.
        TimerStore.addAction(context, "resume")
        TimerStore.plan(context)?.let { TimerStore.savePlan(context, it.copy(paused = false)) }
        TimerRenderer.render(context)
        Refill.run(context, this)
      }
      ACTION_END_BREAK -> {
        // End the break early: drop its "break over" alert and go back to the next-break countdown.
        val plan = TimerStore.plan(context)
        if (plan != null) {
          if (plan.overId.isNotEmpty()) ExpoNotificationsBridge.remove(context, listOf(plan.overId))
          TimerStore.savePlan(context, plan.copy(breakEndsAt = 0, overId = ""))
        }
        TimerStore.addAction(context, "endBreak")
        TimerRenderer.render(context)
        TimerEvents.listener?.invoke()
      }
      ACTION_REFILL -> Refill.run(context, this)
      Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED, EXACT_ALARM_CHANGED -> {
        TimerRenderer.render(context)
        Refill.run(context, this)
      }
      // The timer's alarm, boot, and app update.
      else -> TimerRenderer.render(context)
    }
  }
}
