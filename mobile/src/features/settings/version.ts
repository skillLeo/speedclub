import * as Application from 'expo-application';

import appVersion from '../../../version.json';

/**
 * What "Über die App" shows: the store version and build of the binary on native, the exported build on web, which has
 * no binary and ships from version.json.
 */
export function appVersionInfo(): { version: string; build: string } {
  return {
    version: Application.nativeApplicationVersion ?? appVersion.versionName,
    build: Application.nativeBuildVersion ?? String(appVersion.versionCode),
  };
}
