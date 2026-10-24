import com.android.uiautomator.core.UiDevice;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

/**
 * Screen reader for scripts/e2e-android.sh: writes the screen's accessibility tree (the same XML
 * as `uiautomator dump`) to local/tmp/quack-ui.xml under the runner's data folder, which is
 * /data/local/tmp/local/tmp/quack-ui.xml on the device.
 *
 * `uiautomator dump` first waits for a second without changes on screen, and a ticking countdown
 * (a running break, the tray timer) never gives it one, so a read there took 10 s or failed. This
 * reads straight away; the script reads twice and compares to know the screen has settled.
 *
 * Built and pushed by the e2e script (javac + d8 from the Android SDK); run on the device with
 *   uiautomator runtest quackdump.jar /system/framework/android.test.base.jar -c QuackDump
 */
public class QuackDump extends UiAutomatorTestCase {
    public void testDump() throws Exception {
        UiDevice.getInstance().dumpWindowHierarchy("quack-ui.xml");
    }
}
