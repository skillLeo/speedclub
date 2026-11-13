import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { ErrorState, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';
import { RowGroup } from '@/ui/RowGroup';

import { LOCK_AFTER_OPTIONS, saveAppLock, useAppLockStore, type LockAfter } from '../appLock/appLock';
import { biometricSupport, unlockWithDevice, type BiometricSupport } from '../appLock/biometrics';
import { RadioRows, SwitchRow } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-20';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  skeletonGroup: { gap: t.space[8] },
}));

/** The QA override `qaState=empty` shows the "nicht verfügbar" state on any device. */
const UNAVAILABLE: BiometricSupport = { available: false, reason: 'module' };

/**
 * SET-20 /settings/security/app-lock "App-Sperre" (09 §7.9, §8.3), native only: the switch named after the device's unlock (Face ID,
 * Touch ID, Fingerabdruck, else the device code), "Sperren nach" Sofort / 1 Min. / 5 Min. / 15 Min., and "In der App-Übersicht
 * verbergen" (always on with the lock). Turning it on asks the device once, so nobody locks themselves out. On the web the page does
 * not exist (09 §7.15): a direct link goes back to the settings.
 */
export function AppLockScreen() {
  if (isWeb) return <Redirect href="/settings" />;
  return <NativeAppLockScreen />;
}

function NativeAppLockScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const qaState = useQaState();
  const readOnly = useViewAsReadOnly();
  const status = useSessionStore((state) => state.status);
  const settings = useAppLockStore((state) => state.settings);
  // What this device can unlock with: asked of the system, never stored.
  const supportQuery = useQuery({
    queryKey: ['device', 'biometrics'],
    queryFn: () => biometricSupport(Platform.OS),
    networkMode: 'always',
    retry: false,
    meta: { persist: false },
  });
  const support = supportQuery.data ?? null;
  const failed = supportQuery.isError;
  const check = () => void supportQuery.refetch();
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    if (!next) {
      saveAppLock({ ...settings, enabled: false });
      return;
    }
    setBusy(true);
    const result = await unlockWithDevice(t('appLock.confirmPrompt'), t('appLock.cancel'));
    setBusy(false);
    if (result.ok) {
      saveAppLock({ ...settings, enabled: true });
      toast(t('appLock.enabled'), { haptic: 'success', testID: `${ROUTE}.toast` });
    } else if (result.reason !== 'cancelled') {
      toast(t('appLock.failed'), { haptic: 'warning', testID: `${ROUTE}.failed` });
    }
  };

  const shown = qaState === 'empty' ? UNAVAILABLE : support;
  let body: ReactNode;
  if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/security/app-lock" />;
  } else if (qaState === 'loading' || status === 'loading' || (shown === null && !failed && qaState !== 'error')) {
    body = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.groups}>
          {[1, 4].map((rows) => (
            <View key={rows} style={styles.skeletonGroup}>
              <SkeletonText variant="calloutStrong" width="30%" />
              <SkeletonBlock height={size.row.withThumb * rows} corner="md" />
            </View>
          ))}
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || failed || !shown) {
    body = <ErrorState title={t('appLock.errorTitle')} onRetry={check} testID={`${ROUTE}.error`} />;
  } else if (!shown.available) {
    // The device cannot unlock the app: said plainly, with what would make it work. Nothing to switch on.
    body = (
      <View style={styles.groups} testID={`${ROUTE}.unavailable`}>
        <RowGroup title={t('appLock.group')}>
          <SwitchRow
            title={t('appLock.toggle.passcode')}
            helper={t(`appLock.unavailable.${shown.reason === 'web' ? 'module' : shown.reason}`)}
            value={false}
            onValueChange={() => undefined}
            disabled
            testID={`${ROUTE}.toggle`}
          />
        </RowGroup>
      </View>
    );
  } else {
    const after = settings.after;
    body = (
      <View style={styles.groups}>
        <RowGroup title={t('appLock.group')} testID={`${ROUTE}.lockGroup`}>
          <SwitchRow
            title={t(`appLock.toggle.${shown.kind}`)}
            helper={t('appLock.toggleHelper')}
            value={settings.enabled}
            onValueChange={(next) => void toggle(next)}
            disabled={busy || readOnly}
            divider={false}
            testID={`${ROUTE}.toggle`}
          />
        </RowGroup>
        {settings.enabled ? (
          <RowGroup title={t('appLock.afterTitle')} testID={`${ROUTE}.afterGroup`}>
            <RadioRows<`${LockAfter}`>
              label={t('appLock.afterTitle')}
              options={LOCK_AFTER_OPTIONS.map((seconds) => ({ value: `${seconds}` as const, label: t(`appLock.after.${seconds}`) }))}
              value={`${after}`}
              onChange={(next) => saveAppLock({ ...settings, after: Number(next) as LockAfter })}
              testID={`${ROUTE}.after`}
            />
          </RowGroup>
        ) : null}
        <RowGroup testID={`${ROUTE}.coverGroup`}>
          <SwitchRow
            title={t('appLock.cover')}
            helper={settings.enabled ? t('appLock.coverWithLock') : t('appLock.coverHelper')}
            value={settings.cover || settings.enabled}
            onValueChange={(next) => saveAppLock({ ...settings, cover: next })}
            disabled={settings.enabled || readOnly}
            testID={`${ROUTE}.cover`}
          />
        </RowGroup>
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.note`}>
          {t('appLock.note')}
        </Text>
      </View>
    );
  }

  return (
    <SettingsPage routeId={ROUTE} title={t('appLock.title')} fallback="/settings" section="appLock">
      {body}
    </SettingsPage>
  );
}
