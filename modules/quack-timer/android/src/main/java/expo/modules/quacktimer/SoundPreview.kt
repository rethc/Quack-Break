package expo.modules.quacktimer

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Plays sound previews for the sound picker, one at a time: a new preview stops the last one,
 * like Android's own sound picker. Uses notification volume, so silent mode applies.
 */
object SoundPreview {
  private var current: Ringtone? = null

  /**
   * @param sound a file in res/raw (e.g. "chime.wav"), or "default" for the phone's own sound.
   * @param channelId for "default": the alert's channel, so a tone picked in Android's settings plays.
   */
  @Synchronized
  fun play(ctx: Context, sound: String, channelId: String?) {
    stop()
    val uri = uriFor(ctx, sound, channelId) ?: return
    val ringtone = RingtoneManager.getRingtone(ctx, uri) ?: return
    ringtone.audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    ringtone.play()
    current = ringtone
  }

  @Synchronized
  fun stop() {
    current?.stop()
    current = null
  }

  private fun uriFor(ctx: Context, sound: String, channelId: String?): Uri? {
    if (sound == "default") {
      val channel = if (channelId != null && Build.VERSION.SDK_INT >= 26) {
        ctx.getSystemService(NotificationManager::class.java)?.getNotificationChannel(channelId)
      } else {
        null
      }
      return channel?.sound ?: Settings.System.DEFAULT_NOTIFICATION_URI
    }
    val name = sound.substringBeforeLast('.')
    val id = ctx.resources.getIdentifier(name, "raw", ctx.packageName)
    return if (id == 0) null else Uri.parse("android.resource://${ctx.packageName}/$id")
  }
}
