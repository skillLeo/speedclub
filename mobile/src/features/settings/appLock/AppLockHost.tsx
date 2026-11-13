import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { signOut } from '@/api/queries/auth';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';
import { createStyles, space, ThemeScope } from '@/theme';
import { Button, Screen, Text } from '@/ui';
import { OverlayModal } from '@/ui/overlay';

import { hydrateAppLock, locksAfter, releaseAppLock, unlockApp, useAppLockStore } from './appLock';
import { biometricSupport, unlockWithDevice, type UnlockKind } from './biometrics';

const ROUTE = 'AUTH-15';
/** 09 §7.2 AUTH-15: the small brush logo. */
const LOGO_HEIGHT = space[24] + space[4];
const LOGO_WIDTH = LOGO_HEIGHT * (1200 / 359);

const useStyles = createStyles((t) => ({
  // The cover and the lock are opaque canvas: nothing of the app shows through in the switcher (09 §8.3).
  cover: { alignItems: 'center', backgroundColor: t.color.bg.canvas, justifyContent: 'center', pointerEvents: 'none' },
  lock: { backgroundColor: t.color.bg.canvas, flex: 1 },
  column: { flex: 1, gap: t.space[24], justifyContent: 'center' },
  copy: { gap: t.space[8] },
  actions: { gap: t.space[8] },
}));

/** AUTH-15 and the privacy cover: in the root (SessionHost), native only. */
export function AppLockHost() {
  if (isWeb) return null;
  return <NativeAppLock />;
}

function NativeAppLock() {
  const styles = useStyles();
  const status = useSessionStore((state) => state.status);
  const { settings, locked, covered, hydrated } = useAppLockStore();
  const backgroundAt = useRef<number | null>(null);

  // Cold start: a lock that is on locks before the first screen shows anything of the member.
  useEffect(() => {
    if (status === 'loading' || hydrated) return;
    void hydrateAppLock(status === 'member');
  }, [hydrated, status]);

  // Nothing to protect for a guest: a lock would only stand in front of signing in.
  useEffect(() => {
    if (status === 'guest') releaseAppLock();
  }, [status]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const { settings: current } = useAppLockStore.getState();
      if (next === 'active') {
        const away = backgroundAt.current === null ? 0 : (Date.now() - backgroundAt.current) / 1000;
        backgroundAt.current = null;
        const member = useSessionStore.getState().status === 'member';
        useAppLockStore.setState((state) => ({ covered: false, locked: state.locked || (member && locksAfter(current, away)) }));
        return;
      }
      if (next === 'background' && backgroundAt.current === null) backgroundAt.current = Date.now();
      if (current.cover || current.enabled) useAppLockStore.setState({ covered: true });
    });
    return () => subscription.remove();
  }, []);

  return (
    <>
      {covered && (settings.cover || settings.enabled) ? (
        <View style={[StyleSheet.absoluteFill, styles.cover]} testID={`${ROUTE}.cover`}>
          <AppWordmark width={LOGO_WIDTH} height={LOGO_HEIGHT} decorative />
        </View>
      ) : null}
      {locked && status === 'member' ? <LockScreen /> : null}
    </>
  );
}

/**
 * AUTH-15 (09 §7.2): canvas, the small brush logo, "SPEED CLUB ist gesperrt", the system prompt on appear, "Entsperren" and
 * "Abmelden". It covers every route, so a deep link opens behind it.
 */
export function LockScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const [kind, setKind] = useState<UnlockKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const prompted = useRef(false);

  const unlock = async () => {
    setBusy(true);
    setMessage(null);
    const result = await unlockWithDevice(t('appLock.prompt'), t('appLock.cancel'));
    setBusy(false);
    if (result.ok) {
      unlockApp();
      return;
    }
    if (result.reason === 'invalidated' || result.reason === 'unavailable') setMessage(t('appLock.invalidated'));
    else if (result.reason === 'failed') setMessage(t('appLock.failed'));
  };

  useEffect(() => {
    void biometricSupport(Platform.OS).then((support) => setKind(support.available ? support.kind : null));
    if (prompted.current) return;
    prompted.current = true;
    void unlock();
    // Once per appearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the prompt runs once when the lock appears
  }, []);

  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      releaseAppLock();
      setLeaving(false);
      router.replace('/welcome');
    }
  };

  return (
    <OverlayModal onRequestClose={() => undefined} label={t('appLock.lockedTitle')}>
      <ThemeScope name="carbon">
        <Screen style={styles.lock} testID={`${ROUTE}.root`}>
          <View style={[styles.column, { paddingHorizontal: space[24] }]}>
            <AppWordmark width={LOGO_WIDTH} height={LOGO_HEIGHT} tone="white" />
            <View style={styles.copy}>
              <Text variant="title2" role="heading" testID={`${ROUTE}.title`}>
                {t('appLock.lockedTitle')}
              </Text>
              <Text variant="body" color="text.secondary" testID={`${ROUTE}.body`}>
                {message ?? t(kind ? `appLock.lockedBody.${kind}` : 'appLock.lockedBody.passcode')}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button label={t('appLock.unlock')} size="l" fullWidth loading={busy} disabled={leaving} onPress={() => void unlock()} testID={`${ROUTE}.unlock`} />
              <Button label={t('appLock.signOut')} variant="tertiary" size="m" fullWidth loading={leaving} disabled={busy} onPress={() => void leave()} testID={`${ROUTE}.signOut`} />
            </View>
          </View>
        </Screen>
      </ThemeScope>
    </OverlayModal>
  );
}
