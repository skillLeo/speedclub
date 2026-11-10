import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui';

import { RestrictionNotice } from '../components/RestrictionNotice';
import { SettingsList } from '../components/SettingsList';
import { SettingsPage } from '../components/SettingsPage';
import { useSettingsSplit } from '../components/SettingsSplit';
import { groupHasTitle, ROW_SUBTITLES, visibleGroups } from '../navigation';
import { AccountBody } from './AccountScreen';
import { AppearanceBody } from './AppearanceScreen';

export { valueStacks, type ValueRowGeometry } from '../components/ValueRow';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
  notice: { marginBottom: t.space[24] },
}));

export type SettingsSkeletonGroup = { titled: boolean; height: number };

/**
 * DQ-422: the geometry of the list, from the same group map: each group with its label (none for Konto, DQ-434) and the sum of
 * its rows (56, the subtitled 72), then "Über die App" and, for a member, the untitled "Abmelden".
 */
export function settingsSkeletonGroups(member: boolean): SettingsSkeletonGroup[] {
  const groups = visibleGroups(member).map((group) => ({
    titled: groupHasTitle(group.key),
    height: group.rows.reduce((sum, entry) => sum + (ROW_SUBTITLES[entry.key] ? size.row.withThumb : size.row.single), 0),
  }));
  groups.push({ titled: true, height: size.row.single });
  if (member) groups.push({ titled: false, height: size.row.single });
  return groups;
}

function SettingsSkeleton({ member }: { member: boolean }) {
  const styles = useStyles();
  return (
    <Skeleton testID="SET-01.skeleton">
      <View style={styles.groups}>
        {settingsSkeletonGroups(member).map((group, index) => (
          <View key={index} style={styles.skeletonGroup} testID={`SET-01.skeleton.group.${index}`}>
            {group.titled ? <SkeletonText variant="labelS" width="25%" style={styles.skeletonLabel} /> : null}
            <SkeletonBlock height={group.height} corner="md" testID={`SET-01.skeleton.card.${index}`} />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/**
 * SET-01 (FS-12): Konto · Sicherheit · Privatsphäre · App · Daten · Hilfe · Rechtliches · Über die App · Abmelden. A guest sees
 * only the rows that work without an account. Desktop: the list stands in its 280 pane with SET-01's own testIDs, and beside it
 * the first page of the list, Konto (a guest: Erscheinungsbild).
 */
export function SettingsScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const qaState = useQaState();
  const status = useSessionStore((state) => state.status);
  const split = useSettingsSplit();
  const member = status === 'member';
  const loading = qaState === 'loading' || status === 'loading';

  if (split) {
    // The detail beside the list is Konto, while the session loads too: its own gate draws Konto's skeleton. A guest gets
    // Erscheinungsbild. Either way its row stands selected in the pane (DQ-420).
    const account = member || status === 'loading';
    return (
      <SettingsPage
        routeId="SET-01"
        title={account ? t('account.title') : t('appearance.title')}
        fallback="/profile"
        offlineLabel={t('offline')}
        section={account ? 'account' : 'appearance'}
        pane={{ prefix: 'SET-01', replace: false }}
      >
        {account ? <AccountBody /> : <AppearanceBody />}
      </SettingsPage>
    );
  }

  return (
    <SettingsPage routeId="SET-01" title={t('title')} fallback="/profile" offlineLabel={t('offline')}>
      {member ? <RestrictionNotice routeId="SET-01" style={styles.notice} /> : null}
      {loading ? <SettingsSkeleton member={status !== 'guest'} /> : <SettingsList prefix="SET-01" />}
    </SettingsPage>
  );
}
