package expo.modules.quacktimer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** What the timer notification should show, as sent from JS. Times are epoch milliseconds. */
data class TimerPlan(
  val enabled: Boolean,
  /** End of the running break, or 0. */
  val breakEndsAt: Long,
  /** expo-notifications id of the "break over" notification, cancelled if the break is stopped. */
  val overId: String,
  /** Upcoming reminder times, sorted. */
  val reminders: List<Long>,
  val nextTitle: String,
  /** Shown when the next break is far off, with %s replaced by the time, e.g. "Next break at %s". */
  val nextAtTitle: String,
  val breakTitle: String,
  val stopLabel: String,
  val channelName: String,
) {
  companion object {
    fun fromJson(json: String): TimerPlan {
      val o = JSONObject(json)
      val r = o.optJSONArray("reminders") ?: JSONArray()
      return TimerPlan(
        enabled = o.optBoolean("enabled", false),
        breakEndsAt = o.optLong("breakEndsAt", 0),
        overId = o.optString("overId", ""),
        reminders = (0 until r.length()).map { r.getLong(it) }.sorted(),
        nextTitle = o.optString("nextTitle", "Next break"),
        nextAtTitle = o.optString("nextAtTitle", "Next break at %s"),
        breakTitle = o.optString("breakTitle", "Eye break"),
        stopLabel = o.optString("stopLabel", "Stop"),
        channelName = o.optString("channelName", "Timer"),
      )
    }
  }

  fun toJson(): String = JSONObject()
    .put("enabled", enabled)
    .put("breakEndsAt", breakEndsAt)
    .put("overId", overId)
    .put("reminders", JSONArray(reminders))
    .put("nextTitle", nextTitle)
    .put("nextAtTitle", nextAtTitle)
    .put("breakTitle", breakTitle)
    .put("stopLabel", stopLabel)
    .put("channelName", channelName)
    .toString()
}

/**
 * The plan and the actions taken from the notification (Stop), kept in SharedPreferences so
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
