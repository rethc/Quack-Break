# ExpoNotificationsBridge calls expo-notifications by name (it ships prebuilt, so there's no
# compile-time dependency). expo-notifications keeps these itself today; this makes sure a
# release build still finds them if that ever changes.
-keep class expo.modules.notifications.service.NotificationsService { public static ** Companion; }
-keep class expo.modules.notifications.service.NotificationsService$Companion {
  public void removeAllScheduledNotifications(android.content.Context, android.os.ResultReceiver);
  public void removeScheduledNotifications(android.content.Context, java.util.Collection, android.os.ResultReceiver);
}
-keep class expo.modules.notifications.service.delegates.FirebaseMessagingDelegate { public static ** Companion; }
-keep class expo.modules.notifications.service.delegates.FirebaseMessagingDelegate$Companion {
  public void runTaskManagerTasks(android.content.Context, android.os.Bundle);
}
