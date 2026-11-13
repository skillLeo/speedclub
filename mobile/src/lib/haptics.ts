import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { haptics as hapticTokens, type HapticIntent } from '@/theme/tokens.generated';

import { isWeb } from './platform';
import { getStored, setStored, type StorageKey } from './storage';

/**
 * The haptics service (09 §4.8). One haptic per user intent, never on scroll or per frame; the moments map to a kind in
 * tokens (`haptics.map`). Web is a no-op on purpose: expo-haptics on web vibrates through `navigator.vibrate` or a hidden
 * iOS switch, which the design does not want.
 *
 * Android uses `performAndroidHapticsAsync` (the View haptic constants, no VIBRATE permission) where the API level has the
 * constant, and falls back to the expo-haptics call otherwise, as tokens.json documents per kind.
 */
export type HapticKind = keyof typeof hapticTokens.kinds;

/** The user setting "Haptisches Feedback" (SET-10, M4.10): the key and its default. */
export const HAPTICS_SETTING_KEY = 'haptics';
export const HAPTICS_DEFAULT = true;
/** Where the device keeps the setting: the app's `sc.` namespace, typed in src/lib/storage.ts. '1' on, '0' off. */
export const HAPTICS_STORAGE_KEY = 'sc.haptics' satisfies StorageKey;

let enabled = HAPTICS_DEFAULT;
let hydrated: Promise<void> | null = null;
/** True once SET-10 (or a session override) has set the value: a stored read that resolves later never overwrites it. */
let setExplicitly = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Watches the setting, for the SET-10 switch (`useHapticsSetting` in `src/ui/motion`). Returns the unsubscribe. */
export function subscribeHaptics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the stored setting once. A missing or unreadable value keeps the default (on). */
export function hydrateHaptics(): Promise<void> {
  if (isWeb) return Promise.resolve();
  // getStored never rejects: an unreadable store answers null, which keeps the default.
  hydrated ??= getStored(HAPTICS_STORAGE_KEY).then((value) => {
    if (!setExplicitly && (value === '0' || value === '1') && enabled !== (value === '1')) {
      enabled = value === '1';
      notify();
    }
  });
  return hydrated;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

/** The SET-10 toggle. Stores the choice unless `persist` is false (tests, a session-only override). */
export function setHapticsEnabled(next: boolean, persist = true): void {
  const changed = enabled !== next;
  enabled = next;
  setExplicitly = true;
  if (persist && !isWeb) void setStored(HAPTICS_STORAGE_KEY, next ? '1' : '0');
  if (changed) notify();
}

/** API levels from the Android HapticFeedbackConstants reference: CONFIRM/REJECT 30, SEGMENT_TICK 34. */
const ANDROID_CONFIRM_API = 30;
const ANDROID_SEGMENT_TICK_API = 34;

/** The enum member by name, read when it plays: the enum only matters on Android. */
type AndroidPlan = { type: keyof typeof Haptics.AndroidHaptics; minApi: number };

export const ANDROID_HAPTICS: Readonly<Record<HapticKind, AndroidPlan>> = {
  selection: { type: 'Segment_Tick', minApi: ANDROID_SEGMENT_TICK_API },
  light: { type: 'Virtual_Key', minApi: 0 },
  medium: { type: 'Long_Press', minApi: 0 },
  success: { type: 'Confirm', minApi: ANDROID_CONFIRM_API },
  warning: { type: 'Reject', minApi: ANDROID_CONFIRM_API },
  error: { type: 'Reject', minApi: ANDROID_CONFIRM_API },
};

/** The cross-platform call: iOS always, Android below the constant's API level. */
const FALLBACK: Readonly<Record<HapticKind, () => Promise<void>>> = {
  selection: () => Haptics.selectionAsync(),
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

function androidApi(): number {
  return typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version) || 0;
}

/**
 * The call that plays a kind on a platform: the Android constant from the API level that has it, otherwise the expo-haptics
 * call (iOS always). Pure, so the per-platform plan is testable without a device.
 */
export function effectFor(kind: HapticKind, os: string, androidApiLevel: number): () => Promise<void> {
  if (os === 'android') {
    const plan = ANDROID_HAPTICS[kind];
    if (androidApiLevel >= plan.minApi) return () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics[plan.type]);
  }
  return FALLBACK[kind];
}

export function play(kind: HapticKind): void {
  if (isWeb || !enabled) return;
  // A device without a haptic engine rejects; that must never surface as an error.
  effectFor(kind, Platform.OS, androidApi())().catch(() => undefined);
}

/** The haptic of a moment in the map (09 §4.8), e.g. `hapticFor('follow')` plays light. */
export function hapticFor(intent: HapticIntent): void {
  play(hapticTokens.map[intent]);
}

export const haptics: Readonly<Record<HapticKind, () => void>> = {
  selection: () => play('selection'),
  light: () => play('light'),
  medium: () => play('medium'),
  success: () => play('success'),
  warning: () => play('warning'),
  error: () => play('error'),
};

void hydrateHaptics();
