/**
 * AUTH-15 is native only (09 §8.3): the member web has no app lock. This web file keeps the lock screen, the biometrics module and their
 * dependencies out of the member web's first scripts (M5.12a, 09 §12); AppLockHost.tsx renders nothing on the web either.
 */
export function AppLockHost() {
  return null;
}
