/* eslint-disable @typescript-eslint/no-require-imports */
const { _applyNewIntent } = require('../plugins/withNewIntentAsIntent');

/** The SDK 58 prebuild template of MainActivity.kt, cut to what the plugin touches. */
const kotlin = `package de.speedclub.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

const java = `package de.speedclub.app;

import com.facebook.react.ReactActivity;

public class MainActivity extends ReactActivity {
  @Override
  protected String getMainComponentName() {
    return "main";
  }
}
`;

describe('withNewIntentAsIntent', () => {
  it('keeps a new intent as the activity intent before React Native sees it (Kotlin)', () => {
    const out: string = _applyNewIntent(kotlin, 'kt');
    expect(out).toMatch(/override fun onNewIntent\(intent: Intent\) \{\s*setIntent\(intent\)\s*super\.onNewIntent\(intent\)\s*\}/);
    expect(out).toMatch(/^import android\.content\.Intent$/m);
    expect(out.indexOf('import android.content.Intent')).toBeLessThan(out.indexOf('class MainActivity'));
    // The rest of the template stays as it was.
    expect(out).toContain('SplashScreenManager.registerOnActivity(this)');
    expect(out).toContain('override fun getMainComponentName(): String = "main"');
  });

  it('does the same in a Java template', () => {
    const out: string = _applyNewIntent(java, 'java');
    expect(out).toMatch(/public void onNewIntent\(android\.content\.Intent intent\) \{\s*setIntent\(intent\);\s*super\.onNewIntent\(intent\);/);
  });

  it('does not add the Intent import twice', () => {
    const withImport = kotlin.replace('import android.os.Build', 'import android.content.Intent\nimport android.os.Build');
    const out: string = _applyNewIntent(withImport, 'kt');
    expect(out.match(/^import android\.content\.Intent$/gm)).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once: string = _applyNewIntent(kotlin, 'kt');
    expect(_applyNewIntent(once, 'kt')).toBe(once);
  });

  it('refuses a template that already overrides onNewIntent or has another shape', () => {
    const own = kotlin.replace('class MainActivity : ReactActivity() {', 'class MainActivity : ReactActivity() {\n  override fun onNewIntent(intent: Intent) {}');
    expect(() => _applyNewIntent(own, 'kt')).toThrow(/already overrides onNewIntent/);
    expect(() => _applyNewIntent('class Other {}', 'kt')).toThrow(/not found/);
    expect(() => _applyNewIntent(kotlin, 'groovy')).toThrow(/unexpected/);
  });
});
