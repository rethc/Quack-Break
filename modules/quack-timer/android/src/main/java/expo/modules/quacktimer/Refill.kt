package expo.modules.quacktimer

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * Tops up the booked reminders while the app stays closed. Reminders are booked ahead by the
 * app's JS (expo-notifications), and only so many at a time. JS picks a refill time when it
 * syncs; at that time this runs the same sync again: in the running app if there is one,
 * otherwise as a headless JS task (the path expo-notifications uses for Snooze without
 * opening the app). The JS side is in src/services/backgroundTask.ts.
 */
object Refill {
  private const val RETRY_MS = 60 * 60 * 1000L
  /** How long the process is kept running for the JS to start and book reminders. */
  private const val KEEP_ALIVE_MS = 9_000L

  /** Books the top-up, or cancels it with 0. Inexact: a few minutes late is fine. */
  fun book(ctx: Context, at: Long) {
    val am = ctx.getSystemService(AlarmManager::class.java) ?: return
    val pi = TimerRenderer.receiverIntent(ctx, TimerReceiver.ACTION_REFILL)
    if (at <= 0) {
      am.cancel(pi)
      return
    }
    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
  }

  /** Runs the sync now. Call from a receiver's onReceive. */
  fun run(ctx: Context, receiver: BroadcastReceiver) {
    // Never synced (not set up yet): nothing to top up.
    val plan = TimerStore.plan(ctx) ?: return
    // Try again in an hour; a successful sync books the next top-up itself.
    val retry = System.currentTimeMillis() + RETRY_MS
    TimerStore.savePlan(ctx, plan.copy(refillAt = retry))
    book(ctx, retry)

    val pending = receiver.goAsync()
    val running = TimerEvents.listener
    if (running != null) {
      running()
    } else {
      ExpoNotificationsBridge.runBackgroundTask(ctx, Bundle().apply { putBoolean("quackRefill", true) })
    }
    Handler(Looper.getMainLooper()).postDelayed({ pending.finish() }, KEEP_ALIVE_MS)
  }
}
