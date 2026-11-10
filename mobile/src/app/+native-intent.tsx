import { mapIncomingPath } from '@/features/shell/nativeIntent';

/** https://docs.expo.dev/router/advanced/native-intent/ — this must never throw, or the app crashes on launch. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return mapIncomingPath(path);
  } catch {
    return '/';
  }
}
