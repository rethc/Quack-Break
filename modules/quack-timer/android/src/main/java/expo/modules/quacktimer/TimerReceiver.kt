package expo.modules.quacktimer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import expo.modules.notifications.service.NotificationsService

/**
 * Handles the Stop button, the timer's own alarms, and re-showing the timer after a reboot
 * or an app update. Works without the app's JS running.
 */
class TimerReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_RENDER = "expo.modules.quacktimer.RENDER"
    const val ACTION_STOP = "expo.modules.quacktimer.STOP"
    const val ACTION_END_BREAK = "expo.modules.quacktimer.END_BREAK"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_STOP -> {
        // Stop reminders: cancel everything expo-notifications has booked and hide the timer.
        NotificationsService.removeAllScheduledNotifications(context)
        TimerStore.plan(context)?.let { TimerStore.savePlan(context, it.copy(breakEndsAt = 0, overId = "", reminders = emptyList())) }
        TimerStore.addAction(context, "stop")
        TimerRenderer.cancel(context)
        TimerEvents.listener?.invoke()
      }
      ACTION_END_BREAK -> {
        // End the break early: drop its "break over" alert and go back to the next-break countdown.
        val plan = TimerStore.plan(context)
        if (plan != null) {
          if (plan.overId.isNotEmpty()) NotificationsService.removeScheduledNotifications(context, listOf(plan.overId))
          TimerStore.savePlan(context, plan.copy(breakEndsAt = 0, overId = ""))
        }
        TimerStore.addAction(context, "endBreak")
        TimerRenderer.render(context)
        TimerEvents.listener?.invoke()
      }
      else -> TimerRenderer.render(context)
    }
  }
}
