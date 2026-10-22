package expo.modules.quacktimer

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class QuackTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("QuackTimer")

    Events("onAction")

    OnCreate {
      TimerEvents.listener = { this@QuackTimerModule.sendEvent("onAction", emptyMap<String, Any>()) }
    }

    OnDestroy {
      TimerEvents.listener = null
    }

    /** Saves the plan (JSON, see TimerPlan) and updates the notification right away. */
    Function("setPlan") { json: String ->
      TimerStore.savePlan(context, TimerPlan.fromJson(json))
      TimerRenderer.render(context)
    }

    /** Actions taken from the notification since last time, as a JSON array of {type, at}. */
    Function("takeActions") {
      TimerStore.takeActions(context)
    }
  }
}
