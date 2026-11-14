/**
 * SPEED CLUB — Expo config plugin: a deep link that reaches a restored task still opens its route (M4.19, widget "Mein Auto").
 * Register in mobile/app.config.ts:  plugins: [ ..., './plugins/withNewIntentAsIntent' ]
 *
 * The bug: the widget (react-native-android-widget 0.26.0, RNWidgetProvider.openUri) starts
 * `ACTION_VIEW speedclub://garage/<id>` with FLAG_ACTIVITY_NEW_TASK. MainActivity is `singleTask`, so when the app's task is
 * still in recents but its process was killed, Android relaunches the activity from the task's ORIGINAL intent (the launcher's
 * MAIN, without data) and hands the widget's intent to onNewIntent just before onResume. React Native drops that intent
 * (ReactHostImpl.onNewIntent: "context is not ready"), and expo-router on Android takes its first route from
 * Linking.getInitialURL(), which reads `currentActivity.intent` — the restored launcher intent — so the app opened HOME-01.
 *
 * The fix: MainActivity keeps the newest intent as its own (`setIntent`) before React Native sees it. A cold start still reads
 * the launch intent, a warm start still gets the `url` event, and a restored task now reads the widget's URI as its initial URL.
 * Same for any other deep link (QR /C/…, magic link) that reaches a restored task.
 */
const { withMainActivity } = require('expo/config-plugins');

const MARKER = '// @speedclub/new-intent-as-intent';

function applyKotlin(src) {
  if (src.includes(MARKER)) return src;
  if (/fun\s+onNewIntent\s*\(/.test(src)) {
    throw new Error('[withNewIntentAsIntent] MainActivity.kt already overrides onNewIntent — template changed, merge by hand.');
  }
  const classRe = /class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{/;
  if (!classRe.test(src)) {
    throw new Error('[withNewIntentAsIntent] "class MainActivity : ReactActivity() {" not found — template changed, update the plugin.');
  }
  const method = `
  ${MARKER}
  // A deep link that reaches a restored task (process killed, task in recents) arrives here before React Native runs; keep it
  // as the activity's intent so Linking.getInitialURL() returns it instead of the task's original launcher intent.
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }
`;
  let out = src.replace(classRe, (m) => `${m}${method}`);
  if (!/^import\s+android\.content\.Intent\s*$/m.test(out)) {
    out = out.replace(/^(package\s+[\w.]+\s*\n)/, `$1import android.content.Intent\n`);
  }
  return out;
}

function applyJava(src) {
  if (src.includes(MARKER)) return src;
  if (/void\s+onNewIntent\s*\(/.test(src)) {
    throw new Error('[withNewIntentAsIntent] MainActivity.java already overrides onNewIntent — template changed, merge by hand.');
  }
  const classRe = /public\s+class\s+MainActivity\s+extends\s+ReactActivity\s*\{/;
  if (!classRe.test(src)) {
    throw new Error('[withNewIntentAsIntent] "public class MainActivity extends ReactActivity {" not found — update the plugin.');
  }
  const method = `
  ${MARKER}
  @Override
  public void onNewIntent(android.content.Intent intent) {
    setIntent(intent);
    super.onNewIntent(intent);
  }
`;
  return src.replace(classRe, (m) => `${m}${method}`);
}

function applyNewIntent(src, language) {
  if (language === 'kt') return applyKotlin(src);
  if (language === 'java') return applyJava(src);
  throw new Error(`[withNewIntentAsIntent] unexpected MainActivity language "${language}".`);
}

module.exports = function withNewIntentAsIntent(config) {
  return withMainActivity(config, (cfg) => {
    cfg.modResults.contents = applyNewIntent(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });
};
module.exports._applyNewIntent = applyNewIntent;
