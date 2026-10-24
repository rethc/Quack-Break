package expo.modules.quacktimer

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class QuackTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val listener: () -> Unit = { sendEvent("onAction", emptyMap<String, Any>()) }

  override fun definition() = ModuleDefinition {
    Name("QuackTimer")

    Events("onAction")

    OnCreate {
      TimerEvents.listener = listener
    }

    OnDestroy {
      // A reload creates the new module before destroying the old one; keep the new listener.
      if (TimerEvents.listener === listener) TimerEvents.listener = null
      SoundPreview.stop()
    }

    /** Saves the plan (JSON, see TimerPlan) and updates the notification right away. */
    Function("setPlan") { json: String ->
      TimerStore.savePlan(context, TimerPlan.fromJson(json))
      TimerRenderer.render(context)
    }

    /** Play a sound preview, stopping any that's playing. See SoundPreview. */
    Function("playSound") { sound: String, channelId: String? ->
      SoundPreview.play(context, sound, channelId)
    }

    Function("stopSound") {
      SoundPreview.stop()
    }

    /** Actions taken from the notification since last time, as a JSON array of {type, at}. */
    Function("takeActions") {
      TimerStore.takeActions(context)
    }
  }
}
