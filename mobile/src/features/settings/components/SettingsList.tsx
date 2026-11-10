import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMe, useSignOut } from '@/api/queries/auth';
import { useSessionStore } from '@/state/session';
import { createStyles, useThemePreference } from '@/theme';
import { Dialog, ListRow } from '@/ui';

import { twoFactorEnabledOf } from '../account';
import { groupHasTitle, ROW_SUBTITLES, visibleGroups, type SettingsGroupKey, type SettingsKey } from '../navigation';
import { appVersionInfo } from '../version';
import { CentredRow, RowGroup } from '@/ui/RowGroup';
import { ROW_INSET, ValueRow } from './ValueRow';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  compactGroups: { gap: t.space[24] },
}));

/** testIDs of the groups. The first ones predate M2.5 and the e2e and visual specs use them. */
const GROUP_TEST_ID: Readonly<Record<SettingsGroupKey, string>> = {
  account: 'account',
  security: 'security',
  privacy: 'privacy',
  app: 'app',
  data: 'data',
  help: 'helpGroup',
  legal: 'legalGroup',
};

/** testIDs of the rows; `accountRow` and `privacyRow` because their groups have the plain names. */
const ROW_TEST_ID: Readonly<Record<SettingsKey, string>> = {
  account: 'accountRow',
  password: 'password',
  twoFactor: 'twoFactor',
  sessions: 'sessions',
  privacy: 'privacyRow',
  blocked: 'blocked',
  reports: 'reports',
  notifications: 'notifications',
  appearance: 'appearance',
  language: 'language',
  export: 'export',
  delete: 'delete',
  help: 'help',
  contact: 'contact',
  legal: 'legal',
};

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
 * FS-12, SET-01: grouped inset lists with monochrome icons, "Über die App" with the version, and a centred destructive
 * "Abmelden" behind a dialog. The same list fills the 280 side pane on desktop.
 */
export function SettingsList({ prefix, selected = null, replace = false, compact = false }: SettingsListProps) {
  const { t, i18n } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  const username = useSessionStore((state) => state.member?.username ?? '');
  const member = status === 'member';
  const me = useMe();
  const preference = useThemePreference();
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);
  const { version, build } = appVersionInfo();
  const twoFactor = twoFactorEnabledOf(me.data);

  const open = (path: string) => (replace ? router.replace(path) : router.push(path));
  const confirmSignOut = () =>
    signOut.mutate(undefined, {
      onSettled: () => {
        setConfirming(false);
        router.replace('/welcome');
      },
    });

  const valueOf = (key: SettingsKey): string | null => {
    if (key === 'account') return username ? `@${username}` : null;
    if (key === 'twoFactor') return twoFactor === null ? null : t(twoFactor ? 'rows.on' : 'rows.off');
    if (key === 'appearance') return t(`appearance.options.${preference}`);
    if (key === 'language') return t(`language.names.${i18n.language === 'en' ? 'en' : 'de'}`);
    return null;
  };

  return (
    <View style={compact ? styles.compactGroups : styles.groups}>
      {visibleGroups(member).map((group) => (
        <RowGroup
          key={group.key}
          title={groupHasTitle(group.key) ? t(`groups.${group.key}`) : undefined}
          testID={`${prefix}.${GROUP_TEST_ID[group.key]}`}
        >
          {group.rows.map((entry, index) => {
            const value = valueOf(entry.key);
            const common = {
              icon: entry.icon,
              title: t(`rows.${entry.key}`),
              onPress: () => open(entry.path),
              divider: index < group.rows.length - 1,
              testID: `${prefix}.${ROW_TEST_ID[entry.key]}`,
            };
            const row = { ...common, selected: entry.key === selected };
            const subtitle = ROW_SUBTITLES[entry.key];
            if (value !== null) return <ValueRow key={entry.key} {...row} value={value} />;
            if (subtitle) return <ListRow key={entry.key} {...row} subtitle={t(subtitle)} inset={ROW_INSET} />;
            return <ListRow key={entry.key} {...row} inset={ROW_INSET} />;
          })}
        </RowGroup>
      ))}
      <RowGroup title={t('groups.about')} testID={`${prefix}.about`}>
        <ValueRow icon="info" title={t('rows.version')} value={t('version', { version, build })} testID={`${prefix}.version`} />
      </RowGroup>
      {member ? (
        <RowGroup testID={`${prefix}.signOutGroup`}>
          <CentredRow label={t('signOut.row')} destructive onPress={() => setConfirming(true)} testID={`${prefix}.signOut`} />
        </RowGroup>
      ) : null}
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
