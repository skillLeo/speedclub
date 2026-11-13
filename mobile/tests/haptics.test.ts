import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { haptics as hapticTokens } from '@/theme';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: {
    Confirm: 'confirm',
    Reject: 'reject',
    Long_Press: 'long-press',
    Virtual_Key: 'virtual-key',
    Segment_Tick: 'segment-tick',
  },
}));

type HapticsModule = typeof import('@/lib/haptics');

/** A fresh service, on native (Jest runs as iOS) or on web. */
function load(os: 'ios' | 'web'): HapticsModule {
  let mod!: HapticsModule;
  // The isolated registry would bring its own mock instances: hand it the ones this file asserts on.
  const outerHaptics = Haptics;
  const outerStorage = AsyncStorage;
  jest.isolateModules(() => {
    jest.doMock('expo-haptics', () => outerHaptics);
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: outerStorage }));
    jest.doMock('@/lib/platform', () => ({ isWeb: os === 'web', isNative: os !== 'web', isIOS: os === 'ios', isAndroid: false }));
    mod = jest.requireActual<HapticsModule>('@/lib/haptics');
    jest.dontMock('@/lib/platform');
    jest.dontMock('expo-haptics');
    jest.dontMock('@react-native-async-storage/async-storage');
  });
  return mod;
}

afterEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('haptics service (09 §4.8)', () => {
  it('plays the six kinds with expo-haptics on iOS', () => {
    const { haptics } = load('ios');
    haptics.selection();
    haptics.light();
    haptics.medium();
    haptics.success();
    haptics.warning();
    haptics.error();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('is a no-op on web, where expo-haptics would vibrate', () => {
    const { haptics, hapticFor } = load('web');
    for (const play of Object.values(haptics)) play();
    hapticFor('follow');
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('uses the Android haptic constants from the API level that has them', async () => {
    const { effectFor } = load('ios');
    for (const kind of ['selection', 'light', 'medium', 'success', 'warning', 'error'] as const) await effectFor(kind, 'android', 34)();
    const types = (Haptics.performAndroidHapticsAsync as jest.Mock).mock.calls.map(([type]) => type);
    expect(types).toEqual(['segment-tick', 'virtual-key', 'long-press', 'confirm', 'reject', 'reject']);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('falls back to the expo-haptics call below API 34 (segment tick) and API 30 (confirm, reject)', async () => {
    const { effectFor } = load('ios');
    await effectFor('selection', 'android', 33)();
    await effectFor('success', 'android', 29)();
    await effectFor('light', 'android', 29)();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('virtual-key');
    jest.clearAllMocks();
    await effectFor('warning', 'android', 30)();
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('reject');
  });

  it('never uses the Android constants on iOS', async () => {
    const { effectFor } = load('ios');
    await effectFor('medium', 'ios', 0)();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('plays the kind the map gives a moment, one call per intent', () => {
    const { hapticFor } = load('ios');
    hapticFor('follow');
    expect(hapticTokens.map.follow).toBe('light');
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    hapticFor('vehiclePublished');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    hapticFor('failedAction');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('swallows a device without a haptic engine', async () => {
    (Haptics.selectionAsync as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('no engine')));
    const { haptics } = load('ios');
    expect(() => haptics.selection()).not.toThrow();
    await Promise.resolve();
  });
});

describe('the "haptics" setting (SET-10, default on)', () => {
  it('is on by default and stays silent once switched off', () => {
    const { haptics, hapticsEnabled, setHapticsEnabled, HAPTICS_DEFAULT, HAPTICS_SETTING_KEY } = load('ios');
    expect(HAPTICS_SETTING_KEY).toBe('haptics');
    expect(HAPTICS_DEFAULT).toBe(true);
    expect(hapticsEnabled()).toBe(true);
    setHapticsEnabled(false, false);
    haptics.success();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('stores the choice under sc.haptics and reads it back on the next start', async () => {
    const first = load('ios');
    first.setHapticsEnabled(false);
    await Promise.resolve();
    expect(await AsyncStorage.getItem('sc.haptics')).toBe('0');

    const next = load('ios');
    await next.hydrateHaptics();
    expect(next.hapticsEnabled()).toBe(false);
    next.haptics.light();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('keeps a choice made before the stored value has been read (code review r1)', async () => {
    await AsyncStorage.setItem('sc.haptics', '0');
    // Loading the service starts the stored read; SET-10 switches haptics on before it resolves.
    const service = load('ios');
    service.setHapticsEnabled(true);
    await service.hydrateHaptics();
    expect(service.hapticsEnabled()).toBe(true);
    await Promise.resolve();
    expect(await AsyncStorage.getItem('sc.haptics')).toBe('1');
  });

  it('still takes the stored value when nothing was set first', async () => {
    await AsyncStorage.setItem('sc.haptics', '0');
    const service = load('ios');
    await service.hydrateHaptics();
    expect(service.hapticsEnabled()).toBe(false);
  });

  it('keeps the default when nothing is stored', async () => {
    const service = load('ios');
    await service.hydrateHaptics();
    expect(service.hapticsEnabled()).toBe(true);
  });
});
