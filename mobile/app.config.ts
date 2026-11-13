import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest, withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

import version from './version.json';

const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'local';
// Cleartext HTTP exists only for builds that talk to this PC on the LAN (07_QA_AND_RELEASE.md §7).
const allowCleartext = appEnv === 'local' || appEnv === 'lan';

/**
 * App Links and universal links (M1.7, M2.1): a scanned /C/{code}, a shared /v/{slug} and a member's /u/{username} open the
 * installed app. Only staging and production builds get them, because only their site is HTTPS and serves
 * /.well-known/assetlinks.json and apple-app-site-association (PlatformFilesController::APP_PATHS, the same paths). Local and
 * lan builds keep the speedclub scheme alone. The trailing slash matters: a prefix "/c" would also take /community-richtlinien,
 * and "/u" would take any later /u… page. Keys per docs.expo.dev/versions/v58.0.0/config/app and the linking guides.
 */
const APP_LINK_ENVS: ReadonlySet<string> = new Set(['staging', 'production']);
// SEC-P2-03: the reset and verify mails' https links open the installed app as verified App Links, so their code never has to
// travel over the custom scheme, which any app can claim.
const APP_LINK_PATH_PREFIXES = ['/c/', '/C/', '/v/', '/u/'] as const;
/**
 * Exact paths, so no later /app/reset-password… route is taken along. M4.6 / M4.7: the magic link and "Das war ich nicht" of the
 * mails (/auth/…, redirected to /app/auth/… on the web) carry a token too.
 */
const APP_LINK_PATHS = ['/app/reset-password', '/app/verify-email', '/auth/magic', '/app/auth/magic', '/auth/secure', '/app/auth/secure'] as const;

function appLinkOrigin(): { host: string; port: string | null } | null {
  if (!APP_LINK_ENVS.has(appEnv)) return null;
  const raw = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname ? { host: url.hostname.toLowerCase(), port: url.port || null } : null;
  } catch {
    return null;
  }
}

/**
 * SEC-P1-06: what a release build (build-apk.ps1: lan, staging, production) may ask Android for. The app needs the network, its
 * state for the offline banner, vibration for haptics, and for push (AUTH-10): POST_NOTIFICATIONS, FCM's receive permission and
 * WAKE_LOCK. Libraries add more that nothing here uses, so the release manifest removes them (`tools:node="remove"`):
 * - SYSTEM_ALERT_WINDOW: the React Native dev overlay;
 * - READ/WRITE_EXTERNAL_STORAGE: photos come from the system picker (08 §6);
 * - USE_BIOMETRIC, USE_FINGERPRINT: expo-secure-store's biometric items, never used;
 * - RECEIVE_BOOT_COMPLETED: rescheduling local notifications after a reboot; the app schedules none;
 * - BIND_GET_INSTALL_REFERRER_SERVICE: expo-application's install referrer, never read;
 * - launcher badge permissions of ShortcutBadger (expo-notifications): the app sets no icon badge on Android.
 * Debug and dev-client builds keep the defaults.
 */
const RELEASE_ENVS: ReadonlySet<string> = new Set(['lan', 'staging', 'production']);
const releaseBuild = RELEASE_ENVS.has(appEnv);
const RELEASE_BLOCKED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  'com.android.launcher.permission.READ_SETTINGS',
  'com.android.launcher.permission.WRITE_SETTINGS',
  'com.android.launcher.permission.INSTALL_SHORTCUT',
  'com.android.launcher.permission.UNINSTALL_SHORTCUT',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'com.majeur.launcher.permission.UPDATE_BADGE',
  'com.huawei.android.launcher.permission.CHANGE_BADGE',
  'com.huawei.android.launcher.permission.READ_SETTINGS',
  'com.huawei.android.launcher.permission.WRITE_SETTINGS',
  'android.permission.READ_APP_BADGE',
  'com.oppo.launcher.permission.READ_SETTINGS',
  'com.oppo.launcher.permission.WRITE_SETTINGS',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
] as const;

/** The scheme expo-dev-client adds (`exp+<slug>`): only a dev client answers it. */
const DEV_CLIENT_SCHEME = 'exp+speedclub';

/**
 * SEC-P1-06: `addGeneratedScheme: false` stops adding the scheme, but a prebuild without --clean keeps what an earlier dev build
 * wrote into the native project. A release build therefore takes it out of the manifest and the Info.plist itself.
 */
const withoutDevClientScheme: ConfigPlugin = (config) => {
  const android = withAndroidManifest(config, (mod) => {
    for (const activity of mod.modResults.manifest.application?.[0]?.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (filter.data) filter.data = filter.data.filter((data) => data.$?.['android:scheme'] !== DEV_CLIENT_SCHEME);
      }
    }
    return mod;
  });
  return withInfoPlist(android, (mod) => {
    const types = mod.modResults.CFBundleURLTypes;
    if (types) {
      mod.modResults.CFBundleURLTypes = types
        .map((type) => ({ ...type, CFBundleURLSchemes: type.CFBundleURLSchemes.filter((scheme) => scheme !== DEV_CLIENT_SCHEME) }))
        .filter((type) => type.CFBundleURLSchemes.length > 0);
    }
    return mod;
  });
};

/**
 * Push (AUTH-10, 05 §11): an Expo push token needs the EAS project id, and Android needs Firebase (google-services.json). Both come
 * from the build environment and are owner actions; without them the app runs on with in-app notifications and e-mail.
 */
const easProjectId = process.env.EAS_PROJECT_ID?.trim() || null;
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim() || null;

/**
 * iOS (M2.9, EAS preview → TestFlight; docs/IOS_TESTFLIGHT.md). Keys per docs.expo.dev/versions/v58.0.0/config/app and
 * docs.expo.dev/guides/localization ("Translating app metadata"), checked against the installed @expo/config-types:
 * - the photo library purpose string: German in Info.plist, German and English through `locales` (InfoPlist.strings). The
 *   strings sit under the `ios` key only, so Android gets no strings from them;
 * - CFBundleAllowMixedLocalizations lets the system dialogs follow the device language; CFBundleLocalizations names DE and EN;
 * - ITSAppUsesNonExemptEncryption false (ios.config.usesNonExemptEncryption): the app only uses HTTPS from the OS, so
 *   App Store Connect asks no export-compliance question per build;
 * - staging and production allow HTTPS only (App Transport Security), like Android's usesCleartextTraffic.
 */
const PHOTOS_PURPOSE_DE =
  'SPEED CLUB nutzt deine Fotos, damit du Bilder für dein Profil, deine Fahrzeuge und deine Nachrichten auswählen kannst.';
const PHOTOS_PURPOSE_EN = 'SPEED CLUB uses your photos so you can choose pictures for your profile, your vehicles and your messages.';
const iosHttpsOnly = !allowCleartext ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false } } : {};

const appLink = appLinkOrigin();
const appLinkIos = appLink ? { associatedDomains: [`applinks:${appLink.host}${appLink.port ? `:${appLink.port}` : ''}`] } : {};
const appLinkAndroid = appLink
  ? {
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            ...APP_LINK_PATH_PREFIXES.map((pathPrefix) => ({
              scheme: 'https',
              host: appLink.host,
              ...(appLink.port ? { port: appLink.port } : {}),
              pathPrefix,
            })),
            ...APP_LINK_PATHS.map((path) => ({ scheme: 'https', host: appLink.host, ...(appLink.port ? { port: appLink.port } : {}), path })),
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    }
  : {};

const config: ExpoConfig = {
  name: 'SPEED CLUB',
  slug: 'speedclub',
  scheme: 'speedclub',
  version: version.versionName,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#0B0B0C',
  ios: {
    bundleIdentifier: 'de.speedclub.app',
    buildNumber: String(version.versionCode),
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleLocalizations: ['de', 'en'],
      ...iosHttpsOnly,
    },
    ...appLinkIos,
  },
  locales: {
    de: { ios: { NSPhotoLibraryUsageDescription: PHOTOS_PURPOSE_DE } },
    en: { ios: { NSPhotoLibraryUsageDescription: PHOTOS_PURPOSE_EN } },
  },
  android: {
    package: 'de.speedclub.app',
    versionCode: version.versionCode,
    // Must stay false (ADR-117). With true, Android 13-15 stop calling onBackPressed, and RN 0.88 registers its
    // fallback only on API 36+, so hardware back leaves the app. API 36 gets predictive back from targetSdk 36 anyway.
    predictiveBackGestureEnabled: false,
    ...(releaseBuild ? { blockedPermissions: [...RELEASE_BLOCKED_PERMISSIONS] } : {}),
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: '#0B0B0C',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    ...appLinkAndroid,
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
  plugins: [
    'expo-router',
    // M4.7 SET-20 app lock (09 §8.3): Face ID usage text; Android needs no extra permission text.
    ['expo-local-authentication', { faceIDPermission: 'Damit du SPEED CLUB mit Face ID entsperren kannst.' }],
    // SEC-P1-06: the dev-client scheme (exp+speedclub) only in builds that can open a dev server.
    ['expo-dev-client', { addGeneratedScheme: !releaseBuild }],
    [
      'expo-notifications',
      {
        icon: './assets/images/android-icon-monochrome.png',
        defaultChannel: 'default',
        mode: appEnv === 'production' || appEnv === 'staging' ? 'production' : 'development',
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B0B0C',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
    'expo-image',
    'expo-secure-store',
    // ADR-402: the 2.0 faces are embedded, so native text never waits for a download or swaps fonts. Each file is named
    // after its PostScript name: iOS opens it by that name (UIAppFonts), Android looks it up as assets/fonts/<name>.ttf, one
    // family per weight. An explicit list keeps the web woff2 files in assets/fonts/web out of the iOS bundle.
    // tests/fonts.test.tsx keeps this list equal to the faces tokens.json names.
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/Inter-Regular.ttf',
          './assets/fonts/Inter-Medium.ttf',
          './assets/fonts/Inter-SemiBold.ttf',
          './assets/fonts/Inter-Bold.ttf',
          './assets/fonts/InterDisplay-SemiBold.ttf',
          './assets/fonts/InterDisplay-Bold.ttf',
          './assets/fonts/ArchivoCondensed-SemiBold.ttf',
          './assets/fonts/ArchivoCondensed-Bold.ttf',
          './assets/fonts/ArchivoSemiExpanded-SemiBold.ttf',
          './assets/fonts/ArchivoSemiExpanded-Bold.ttf',
        ],
      },
    ],
    'expo-status-bar',
    // Without enforceContrast: false, Android ignores NavigationBar.setStyle (ThemeProvider).
    ['expo-navigation-bar', { enforceContrast: false }],
    'expo-localization',
    'expo-sharing',
    'expo-web-browser',
    // Photos come from the system picker. The app never opens the camera or records sound, so both permissions are blocked.
    [
      'expo-image-picker',
      {
        photosPermission: PHOTOS_PURPOSE_DE,
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: allowCleartext,
          // Real phones only. Pass -Abis to build-apk.ps1 when an emulator build needs x86_64.
          buildArchs: ['arm64-v8a', 'armeabi-v7a'],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    './plugins/withReleaseSigning',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    baseUrl: '/app',
  },
};

export default releaseBuild ? withoutDevClientScheme(config) : config;
