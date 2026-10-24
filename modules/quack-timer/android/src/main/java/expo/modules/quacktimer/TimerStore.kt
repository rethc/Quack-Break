package expo.modules.quacktimer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** What the timer notification should show, as sent from JS. Times are epoch milliseconds. */
data class TimerPlan(
  /** Show the countdown notification (the tray timer setting). */
  val enabled: Boolean,
  /** Reminders are stopped: show "Reminders stopped" with Resume. */
  val paused: Boolean,
  /** End of the running break, or 0. */
  val breakEndsAt: Long,
  /** expo-notifications id of the "break over" notification, cancelled if the break is stopped. */
  val overId: String,
  /** Upcoming reminder times, sorted. */
  val reminders: List<Long>,
  /** When to run the app's sync in the background to book more reminders, or 0. */
  val refillAt: Long,
  val nextTitle: String,
  /** Shown when the next break is far off, with %s replaced by the time, e.g. "Next break at %s". */
  val nextAtTitle: String,
  val breakTitle: String,
  val stopLabel: String,
  val stoppedTitle: String,
  val stoppedText: String,
  val resumeLabel: String,
  val channelName: String,
) {
  companion object {
    fun fromJson(json: String): TimerPlan {
      val o = JSONObject(json)
      val r = o.optJSONArray("reminders") ?: JSONArray()
      return TimerPlan(
        enabled = o.optBoolean("enabled", false),
        paused = o.optBoolean("paused", false),
        breakEndsAt = o.optLong("breakEndsAt", 0),
        overId = o.optString("overId", ""),
        reminders = (0 until r.length()).map { r.getLong(it) }.sorted(),
        refillAt = o.optLong("refillAt", 0),
        nextTitle = o.optString("nextTitle", "Next break"),
        nextAtTitle = o.optString("nextAtTitle", "Next break at %s"),
        breakTitle = o.optString("breakTitle", "Eye break"),
        stopLabel = o.optString("stopLabel", "Stop"),
        stoppedTitle = o.optString("stoppedTitle", "Reminders stopped"),
        stoppedText = o.optString("stoppedText", ""),
        resumeLabel = o.optString("resumeLabel", "Resume"),
        channelName = o.optString("channelName", "Timer"),
      )
    }
  }

  fun toJson(): String = JSONObject()
    .put("enabled", enabled)
    .put("paused", paused)
    .put("breakEndsAt", breakEndsAt)
    .put("overId", overId)
    .put("reminders", JSONArray(reminders))
    .put("refillAt", refillAt)
    .put("nextTitle", nextTitle)
    .put("nextAtTitle", nextAtTitle)
    .put("breakTitle", breakTitle)
    .put("stopLabel", stopLabel)
    .put("stoppedTitle", stoppedTitle)
    .put("stoppedText", stoppedText)
    .put("resumeLabel", resumeLabel)
    .put("channelName", channelName)
    .toString()
}

/**
 * The plan and the actions taken from the notification (Stop, Resume), kept in SharedPreferences so
 * alarms, reboots and the Stop button work while the app isn't running. JS picks the actions
 * up with takeActions() and applies them to its own state.
 */
object TimerStore {
  private const val PREFS = "quack_timer"
  private const val KEY_PLAN = "plan"
  private const val KEY_ACTIONS = "actions"

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun plan(ctx: Context): TimerPlan? =
    prefs(ctx).getString(KEY_PLAN, null)?.let { runCatching { TimerPlan.fromJson(it) }.getOrNull() }

  fun savePlan(ctx: Context, plan: TimerPlan) {
    prefs(ctx).edit().putString(KEY_PLAN, plan.toJson()).apply()
  }

  /** Records an action such as "stop" or "endBreak" with the time it happened. */
  @Synchronized
  fun addAction(ctx: Context, type: String) {
    val list = JSONArray(prefs(ctx).getString(KEY_ACTIONS, "[]"))
    list.put(JSONObject().put("type", type).put("at", System.currentTimeMillis()))
    prefs(ctx).edit().putString(KEY_ACTIONS, list.toString()).apply()
  }

  /** Returns the recorded actions as a JSON array string and clears them. */
  @Synchronized
  fun takeActions(ctx: Context): String {
    val json = prefs(ctx).getString(KEY_ACTIONS, "[]") ?: "[]"
    prefs(ctx).edit().remove(KEY_ACTIONS).apply()
    return json
  }
}

/** Lets the receiver tell a running app that an action happened. */
object TimerEvents {
  @Volatile
  var listener: (() -> Unit)? = null
}
