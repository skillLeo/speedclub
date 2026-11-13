import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMe, useSignOut } from '@/api/queries/auth';
import { useMemberSettings } from '@/api/queries/settings';
import { usePowerDisplayPreference } from '@/lib/powerDisplay';
import { useSessionStore } from '@/state/session';
import { createStyles, useThemePreference } from '@/theme';
import { Dialog, ListRow, Text } from '@/ui';
import { CentredRow, RowGroup } from '@/ui/RowGroup';

import { twoFactorEnabledOf } from '../account';
import { useAppLockStore } from '../appLock/appLock';
import { useClearCache } from '../cache';
import { groupHasTitle, ROW_SUBTITLES, visibleGroups, type SettingsFlags, type SettingsGroupKey, type SettingsKey } from '../navigation';
import { languageSummary } from '../unitsSummary';
import { appVersionInfo } from '../version';
import { IdentityCard } from './IdentityCard';
import { ROW_INSET, ValueRow } from './ValueRow';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  compactGroups: { gap: t.space[24] },
  footer: { paddingHorizontal: t.space[16], textAlign: 'center' },
}));

/** testIDs of the groups. The first ones predate M2.5 and the e2e and visual specs use them (`SET-01.account`, `SET-01.app`). */
const GROUP_TEST_ID: Readonly<Record<SettingsGroupKey, string>> = {
  account: 'account',
  security: 'security',
  privacy: 'privacy',
  app: 'app',
  more: 'more',
  data: 'data',
  help: 'helpGroup',
  legal: 'legalGroup',
  about: 'about',
};

/** testIDs of the rows; `accountRow` and `privacyRow` because their groups have the plain names. */
const ROW_TEST_ID: Readonly<Record<SettingsKey, string>> = {
  account: 'accountRow',
  signIn: 'signIn',
  appLock: 'appLock',
  activity: 'activity',
  password: 'password',
  twoFactor: 'twoFactor',
  sessions: 'sessions',
  privacy: 'privacyRow',
  blocked: 'blocked',
  reports: 'reports',
  notifications: 'notifications',
  appearance: 'appearance',
  appIcon: 'appIcon',
  language: 'language',
  reminders: 'reminders',
  business: 'business',
  membership: 'membership',
  export: 'export',
  delete: 'delete',
  help: 'help',
  contact: 'contact',
  legal: 'legal',
  whatsNew: 'whatsNew',
};

/** The flags of the SET-01 rows, as one map. */
export function useSettingsFlags(): SettingsFlags {
  const maintenance = useFlag('maintenance');
  const businesses = useFlag('businesses');
  const membership = useFlag('membership');
  const appIcons = useFlag('app_icons');
  return { maintenance, businesses, membership, app_icons: appIcons };
}

export type SettingsListProps = {
  /** `SET-01` on the list itself, `<ROUTE-ID>.nav` in the desktop side pane. */
  prefix: string;
  /** The page the side pane stands beside. */
  selected?: SettingsKey | null;
  /** The side pane swaps the detail instead of stacking a page on it. */
  replace?: boolean;
  /** The narrower gaps of the 280 pane. */
  compact?: boolean;
};

/**
 * SET-01 (09 §7.9): the identity card, then grouped inset lists with monochrome glyphs and the current values inline
 * ("Carbon", "Deutsch · PS · km"), "Cache leeren" in Daten & Speicher, Was ist neu with the version in Über SPEED CLUB, a centred
 * destructive "Abmelden" behind a dialog and the version caption. The same list fills the 280 side pane on desktop.
 */
export function SettingsList({ prefix, selected = null, replace = false, compact = false }: SettingsListProps) {
  const { t, i18n } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  const member = status === 'member';
  const me = useMe();
  const settings = useMemberSettings();
  const preference = useThemePreference();
  const power = usePowerDisplayPreference();
  const flags = useSettingsFlags();
  const signOut = useSignOut();
  const cache = useClearCache(`${prefix}.cache`);
  const [confirming, setConfirming] = useState(false);
  const { version, build } = appVersionInfo();
  const twoFactor = twoFactorEnabledOf(me.data);
  const appLock = useAppLockStore((state) => state.settings.enabled);

  const open = (path: string) => (replace ? router.replace(path) : router.push(path));
  const confirmSignOut = () =>
    signOut.mutate(undefined, {
      onSettled: () => {
        setConfirming(false);
        router.replace('/welcome');
      },
    });

  const valueOf = (key: SettingsKey): string | null => {
    if (key === 'twoFactor') return twoFactor === null ? null : t(twoFactor ? 'rows.on' : 'rows.off');
    if (key === 'appLock') return t(appLock ? 'rows.on' : 'rows.off');
    if (key === 'appearance') return t(`appearance.short.${preference}`);
    if (key === 'language') return languageSummary(t, i18n.language, power, settings.data?.distance_unit ?? 'km');
    return null;
  };

  return (
    <View style={compact ? styles.compactGroups : styles.groups}>
      {visibleGroups(member, undefined, flags).map((group) => {
        const testID = `${prefix}.${GROUP_TEST_ID[group.key]}`;
        if (group.key === 'account') {
          return (
            <View key={group.key} testID={testID}>
              <IdentityCard
                onPress={() => open(group.rows[0]?.path ?? '/settings/account')}
                selected={selected === 'account'}
                compact={compact}
                testID={`${prefix}.${ROW_TEST_ID.account}`}
              />
            </View>
          );
        }
        const extra = group.key === 'data' || group.key === 'about';
        return (
          <RowGroup key={group.key} title={groupHasTitle(group.key) ? t(`groups.${group.key}`) : undefined} testID={testID}>
            {group.rows.map((entry, index) => {
              const value = valueOf(entry.key);
              const row = {
                icon: entry.icon,
                title: t(`rows.${entry.key}`),
                onPress: () => open(entry.path),
                divider: index < group.rows.length - 1 || extra,
                testID: `${prefix}.${ROW_TEST_ID[entry.key]}`,
                selected: entry.key === selected,
                // DQ-1018: "Aktivität" leans on its group header; a screen reader moving row by row hears the whole word.
                ...(entry.key === 'activity' ? { accessibilityTitle: t('activity.title') } : {}),
              };
              const subtitle = ROW_SUBTITLES[entry.key];
              if (value !== null) return <ValueRow key={entry.key} {...row} value={value} />;
              if (subtitle) return <ListRow key={entry.key} {...row} subtitle={t(subtitle)} inset={ROW_INSET} />;
              return <ListRow key={entry.key} {...row} inset={ROW_INSET} />;
            })}
            {group.key === 'data' ? (
              <ListRow
                icon="arrow-clockwise"
                title={t('cache.row')}
                subtitle={t('cache.hint')}
                onPress={cache.ask}
                role="button"
                chevron={false}
                inset={ROW_INSET}
                testID={`${prefix}.cache`}
              />
            ) : null}
            {group.key === 'about' ? (
              <ValueRow icon="info" title={t('rows.version')} value={t('version', { version, build })} testID={`${prefix}.version`} />
            ) : null}
          </RowGroup>
        );
      })}
      {member ? (
        <RowGroup testID={`${prefix}.signOutGroup`}>
          <CentredRow label={t('signOut.row')} destructive onPress={() => setConfirming(true)} testID={`${prefix}.signOut`} />
        </RowGroup>
      ) : null}
      {compact ? null : (
        <Text variant="caption" color="text.tertiary" style={styles.footer} testID={`${prefix}.footer`}>
          {t('footer', { version, build })}
        </Text>
      )}
      {cache.dialog}
      <Dialog
        visible={confirming}
        onClose={signOut.isPending ? undefined : () => setConfirming(false)}
        title={t('signOut.title')}
        body={t('signOut.body')}
        testID={`${prefix}.signOutDialog`}
        actions={[
          {
            label: t('signOut.cancel'),
            variant: 'secondary',
            disabled: signOut.isPending,
            onPress: () => setConfirming(false),
            testID: `${prefix}.signOutDialog.cancel`,
          },
          {
            label: t('signOut.confirm'),
            variant: 'primary',
            loading: signOut.isPending,
            onPress: confirmSignOut,
            testID: `${prefix}.signOutDialog.confirm`,
          },
        ]}
      />
    </View>
  );
}
