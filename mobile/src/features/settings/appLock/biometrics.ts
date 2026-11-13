/**
 * SET-20 / AUTH-15 (09 §8.3): the device's own unlock (Face ID, Touch ID, fingerprint, else the device passcode) behind one small
 * adapter. It reads `expo-local-authentication` as an optional module: Metro keeps a `require` inside try/catch optional
 * (`allowOptionalDependencies`, on in Expo's Metro config), so a build without the native module says "nicht verfügbar" instead of
 * failing, and the same code works once the lead installs it (`npx expo install expo-local-authentication`). The web has no app lock.
 */
import { isWeb } from '@/lib/platform';

/** What the toggle is called after: the hardware the device unlocks with. `passcode`: no biometrics, the device code only. */
export type UnlockKind = 'faceId' | 'touchId' | 'fingerprint' | 'face' | 'passcode';

export type BiometricSupport =
  /** The module is not in this build, or the device has no way to unlock (no passcode set either). */
  | { available: false; reason: 'module' | 'hardware' | 'notEnrolled' | 'web' }
  | { available: true; kind: UnlockKind };

export type UnlockResult = { ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' | 'invalidated' };

/** The part of expo-local-authentication this adapter uses (docs.expo.dev/versions/v58.0.0/sdk/local-authentication). */
type LocalAuthentication = {
  hasHardwareAsync: () => Promise<boolean>;
  isEnrolledAsync: () => Promise<boolean>;
  supportedAuthenticationTypesAsync: () => Promise<number[]>;
  getEnrolledLevelAsync?: () => Promise<number>;
  authenticateAsync: (options: {
    promptMessage?: string;
    cancelLabel?: string;
    fallbackLabel?: string;
    disableDeviceFallback?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
};

/** AuthenticationType of the module: 1 fingerprint, 2 facial recognition, 3 iris. */
const FINGERPRINT = 1;
const FACIAL = 2;
/** SecurityLevel of the module: 0 none; 1 secret (a passcode); 2, 3 biometrics. */
const SECURITY_NONE = 0;

let override: LocalAuthentication | null | undefined;

function load(): LocalAuthentication | null {
  if (override !== undefined) return override;
  if (isWeb) return null;
  try {
    // An optional native module (see above): absent until the lead installs it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional module, read lazily so a build without it still runs
    return require('expo-local-authentication') as LocalAuthentication;
  } catch {
    return null;
  }
}

/** Tests: a fake module, or null for a build without it; `undefined` goes back to the real one. */
export function __setLocalAuthenticationForTests(module: LocalAuthentication | null | undefined): void {
  override = module;
}

export async function biometricSupport(os: string): Promise<BiometricSupport> {
  if (isWeb) return { available: false, reason: 'web' };
  const module = load();
  if (!module) return { available: false, reason: 'module' };
  try {
    const [hardware, enrolled, types, level] = await Promise.all([
      module.hasHardwareAsync(),
      module.isEnrolledAsync(),
      module.supportedAuthenticationTypesAsync(),
      module.getEnrolledLevelAsync ? module.getEnrolledLevelAsync() : Promise.resolve(null),
    ]);
    if (hardware && enrolled) {
      if (types.includes(FACIAL)) return { available: true, kind: os === 'ios' ? 'faceId' : 'face' };
      if (types.includes(FINGERPRINT)) return { available: true, kind: os === 'ios' ? 'touchId' : 'fingerprint' };
    }
    // No biometrics set up, but a device code: it unlocks with that (09 §8.3 "fallback to device passcode").
    if (level !== null && level > SECURITY_NONE) return { available: true, kind: 'passcode' };
    return { available: false, reason: hardware ? 'notEnrolled' : 'hardware' };
  } catch {
    return { available: false, reason: 'hardware' };
  }
}

/** The system prompt; the device passcode is offered when biometrics fail. */
export async function unlockWithDevice(promptMessage: string, cancelLabel: string): Promise<UnlockResult> {
  const module = load();
  if (!module) return { ok: false, reason: 'unavailable' };
  try {
    const result = await module.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: false });
    if (result.success) return { ok: true };
    const error = result.error ?? '';
    if (error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel') return { ok: false, reason: 'cancelled' };
    if (error === 'not_enrolled' || error === 'passcode_not_set' || error === 'not_available') return { ok: false, reason: 'invalidated' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
