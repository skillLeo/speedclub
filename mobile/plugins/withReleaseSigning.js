/**
 * SPEED CLUB — Expo config plugin: sign Android RELEASE builds with the upload keystore.
 * Copied by scripts/setup-windows.ps1 to mobile/plugins/withReleaseSigning.js
 * Register in mobile/app.config.ts:  plugins: [ ..., './plugins/withReleaseSigning' ]
 *
 * Credentials are NEVER in the repo. Gradle reads them from %USERPROFILE%\.gradle\gradle.properties:
 *   SPEEDCLUB_UPLOAD_STORE_FILE=C:/speedclub-secrets/speedclub-upload.keystore
 *   SPEEDCLUB_UPLOAD_STORE_PASSWORD=...
 *   SPEEDCLUB_UPLOAD_KEY_ALIAS=speedclub
 *   SPEEDCLUB_UPLOAD_KEY_PASSWORD=...
 * A release build without these properties FAILS on purpose (we never ship debug-signed APKs).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @speedclub/release-signing';

function applySigning(src) {
  if (src.includes(MARKER)) return src;

  // 1) Add a "release" signing config inside signingConfigs { ... }
  const signingBlock = `
        release { ${MARKER}
            if (project.hasProperty('SPEEDCLUB_UPLOAD_STORE_FILE')) {
                storeFile file(project.property('SPEEDCLUB_UPLOAD_STORE_FILE'))
                storePassword project.property('SPEEDCLUB_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('SPEEDCLUB_UPLOAD_KEY_ALIAS')
                keyPassword project.property('SPEEDCLUB_UPLOAD_KEY_PASSWORD')
            }
        }`;
  if (!/signingConfigs\s*\{/.test(src)) {
    throw new Error('[withReleaseSigning] "signingConfigs {" not found in android/app/build.gradle — template changed, update the plugin.');
  }
  let out = src.replace(/signingConfigs\s*\{/, (m) => `${m}${signingBlock}`);

  // 2) Point buildTypes.release at signingConfigs.release (template default is signingConfigs.debug)
  const releaseRe = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
  if (!releaseRe.test(out)) {
    throw new Error('[withReleaseSigning] could not find "signingConfig signingConfigs.debug" in buildTypes.release — update the plugin.');
  }
  out = out.replace(releaseRe, '$1signingConfig signingConfigs.release');

  // 3) Fail fast if someone builds a release without credentials
  out += `
${MARKER} guard
// configuration-cache safe: inspects the requested task names only
def speedclubWantsRelease = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
if (speedclubWantsRelease && !project.hasProperty('SPEEDCLUB_UPLOAD_STORE_FILE')) {
    throw new GradleException("SPEED CLUB: release signing is not configured. Add SPEEDCLUB_UPLOAD_* to %USERPROFILE%/.gradle/gradle.properties (see docs/07_QA_AND_RELEASE.md).")
}
`;
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('[withReleaseSigning] expected Groovy build.gradle; this template uses ' + cfg.modResults.language + ' — port the plugin to Kotlin DSL.');
    }
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports._applySigning = applySigning; // exported for the Jest unit test
