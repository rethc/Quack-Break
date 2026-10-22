package expo.modules.quacktimer

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.text.DateFormat
import java.util.Date

/**
 * Shows the ongoing countdown notification for the current moment and books an alarm for the
 * next change. Android counts the chronometer down by itself, so nothing runs in between.
 *
 * - During a break: "Eye break" counting down to the end, with Stop (ends the break).
 * - Between breaks: "Next break in" counting down to the next reminder, with Stop (stops reminders).
 *   More than two hours away (e.g. overnight), it shows the time instead of a long countdown.
 *
 * The body is a small custom layout (title + countdown line) inside the standard notification
 * frame, so the time reads like normal text. A custom body rules out Android 16 Live Updates.
 */
object TimerRenderer {
  const val NOTIFICATION_ID = 4201
  private const val CHANNEL_ID = "quack_timer"
  private const val FAR_MS = 2 * 60 * 60 * 1000L
  private const val ICON_META = "expo.modules.notifications.default_notification_icon"
  private const val COLOR = 0xFFF5B935.toInt()

  fun render(ctx: Context) {
    cancelAlarm(ctx)
    val nm = NotificationManagerCompat.from(ctx)
    val plan = TimerStore.plan(ctx)
    if (plan == null || !plan.enabled || !canNotify(ctx)) {
      nm.cancel(NOTIFICATION_ID)
      return
    }
    val now = System.currentTimeMillis()
    ensureChannel(ctx, plan.channelName)

    if (plan.breakEndsAt > now) {
      post(ctx, plan.breakTitle, plan.breakEndsAt, countdown = true, stopAction = TimerReceiver.ACTION_END_BREAK, plan)
      scheduleAlarm(ctx, plan.breakEndsAt + 500)
      return
    }

    val next = plan.reminders.firstOrNull { it > now + 1000 }
    if (next == null) {
      nm.cancel(NOTIFICATION_ID)
      return
    }
    if (next - now > FAR_MS) {
      val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(next))
      post(ctx, plan.nextAtTitle.replace("%s", time), next, countdown = false, stopAction = TimerReceiver.ACTION_STOP, plan)
      scheduleAlarm(ctx, next - FAR_MS)
    } else {
      post(ctx, plan.nextTitle, next, countdown = true, stopAction = TimerReceiver.ACTION_STOP, plan)
      scheduleAlarm(ctx, next + 500)
    }
  }

  fun cancel(ctx: Context) {
    cancelAlarm(ctx)
    NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID)
  }

  private fun canNotify(ctx: Context): Boolean {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
  }

  private fun post(
    ctx: Context,
    title: String,
    target: Long,
    countdown: Boolean,
    stopAction: String,
    plan: TimerPlan,
  ) {
    val body = RemoteViews(ctx.packageName, R.layout.quack_timer_content)
    body.setTextViewText(R.id.quack_timer_title, title)
    if (countdown) {
      // Chronometer counts against the elapsed-time clock, which doesn't jump when the wall clock changes.
      val base = SystemClock.elapsedRealtime() + (target - System.currentTimeMillis())
      body.setChronometer(R.id.quack_timer_clock, base, null, true)
      body.setChronometerCountDown(R.id.quack_timer_clock, true)
      body.setViewVisibility(R.id.quack_timer_clock, View.VISIBLE)
    } else {
      body.setViewVisibility(R.id.quack_timer_clock, View.GONE)
    }

    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(smallIcon(ctx))
      .setColor(COLOR)
      .setContentTitle(title)
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(body)
      .setShowWhen(false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(openApp(ctx))
      .addAction(0, plan.stopLabel, receiverIntent(ctx, stopAction))
    // Disappear exactly when the countdown hits zero; the alarm then shows what comes next.
    if (countdown) builder.setTimeoutAfter(target - System.currentTimeMillis())
    try {
      NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      // Permission was revoked between the check and now.
    }
  }

  private fun ensureChannel(ctx: Context, name: String) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    // Low importance: no sound, no pop-up.
    val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
      description = "Countdown to your next break"
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun smallIcon(ctx: Context): Int {
    val meta = runCatching {
      ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA).metaData
    }.getOrNull()
    val icon = meta?.getInt(ICON_META, 0) ?: 0
    return if (icon != 0) icon else ctx.applicationInfo.icon
  }

  private fun openApp(ctx: Context): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun receiverIntent(ctx: Context, action: String): PendingIntent {
    val intent = Intent(ctx, TimerReceiver::class.java).setAction(action)
    return PendingIntent.getBroadcast(ctx, action.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun scheduleAlarm(ctx: Context, at: Long) {
    val am = ctx.getSystemService(AlarmManager::class.java) ?: return
    val pi = receiverIntent(ctx, TimerReceiver.ACTION_RENDER)
    val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
    if (exact) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  private fun cancelAlarm(ctx: Context) {
    ctx.getSystemService(AlarmManager::class.java)?.cancel(receiverIntent(ctx, TimerReceiver.ACTION_RENDER))
  }
}
