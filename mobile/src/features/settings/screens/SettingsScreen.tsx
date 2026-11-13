import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { HeaderLargeTitle, SettingsSearch, Skeleton, SkeletonBlock, SkeletonText, useCollapsingHeader } from '@/ui';

import { RestrictionNotice } from '../components/RestrictionNotice';
import { SettingsList, useSettingsFlags } from '../components/SettingsList';
import { SettingsPage } from '../components/SettingsPage';
import { useSettingsSplit } from '../components/SettingsSplit';
import { groupHasTitle, ROW_SUBTITLES, visibleGroups, type SettingsFlags } from '../navigation';
import { initialSearchQuery, searchSettings } from '../search';
import { AccountBody } from './AccountScreen';
import { AppearanceBody } from './AppearanceScreen';

export { valueStacks, type ValueRowGeometry } from '../components/ValueRow';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  // The large title's own gutter: the settings column already stands on it.
  largeTitle: { paddingHorizontal: 0 },
  search: { marginBottom: t.space[24] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
  notice: { marginBottom: t.space[24] },
}));

export type SettingsSkeletonGroup = { titled: boolean; height: number };

/**
 * DQ-422: the geometry of the list, from the same group map: the identity card (a 72 row with its 56 avatar), each group with its
 * label (DQ-434) and the sum of its rows (56, the subtitled 72) plus the extra rows the list adds (Cache leeren 72, the version 56),
 * then, for a member, the untitled "Abmelden".
 */
export function settingsSkeletonGroups(member: boolean, flags: SettingsFlags = {}, web: boolean = isWeb): SettingsSkeletonGroup[] {
  const groups = visibleGroups(member, web, flags).map((group) => {
    const rows = group.rows.reduce((sum, entry) => sum + (entry.key === 'account' || ROW_SUBTITLES[entry.key] ? size.row.withThumb : size.row.single), 0);
    const extra = group.key === 'data' ? size.row.withThumb : group.key === 'about' ? size.row.single : 0;
    return { titled: groupHasTitle(group.key), height: rows + extra };
  });
  if (member) groups.push({ titled: false, height: size.row.single });
  return groups;
}

function SettingsSkeleton({ member }: { member: boolean }) {
  const flags = useSettingsFlags();
  const styles = useStyles();
  return (
    <Skeleton testID="SET-01.skeleton">
      <View style={styles.groups}>
        <SkeletonBlock height={size.search} corner="md" testID="SET-01.skeleton.search" />
        {settingsSkeletonGroups(member, flags).map((group, index) => (
          <View key={index} style={styles.skeletonGroup} testID={`SET-01.skeleton.group.${index}`}>
            {group.titled ? <SkeletonText variant="callout" width="25%" style={styles.skeletonLabel} /> : null}
            <SkeletonBlock height={group.height} corner="md" testID={`SET-01.skeleton.card.${index}`} />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/**
 * SET-01 (09 §7.9): large title, the settings search (SET-26), the identity card and the groups with their current values. While
 * the search holds a query its matches replace the list. A guest sees only the rows that work without an account. Desktop: the
 * list stands in its 280 pane with SET-01's own testIDs, and beside it the first page of the list, Konto (a guest: Darstellung).
 */
export function SettingsScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const qaState = useQaState();
  const status = useSessionStore((state) => state.status);
  const split = useSettingsSplit();
  const member = status === 'member';
  const loading = qaState === 'loading' || status === 'loading';
  const header = useCollapsingHeader();
  const router = useRouter();
  const flags = useSettingsFlags();
  // Web: `?q=` opens the search with a query (a link from a help article, and the visual capture of SET-26).
  const [query, setQuery] = useState(initialSearchQuery);
  const results = searchSettings(query, t, { member, web: isWeb, flags }).map((result) => ({
    ...result,
    onPress: () => router.push(result.path),
  }));

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
    <SettingsPage routeId="SET-01" title={t('title')} collapsing={header} fallback="/profile" offlineLabel={t('offline')}>
      <HeaderLargeTitle title={t('title')} scroll={header} style={styles.largeTitle} testID="SET-01.title" />
      {member ? <RestrictionNotice routeId="SET-01" style={styles.notice} /> : null}
      {loading ? null : (
        <View style={styles.search}>
          <SettingsSearch
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            results={results}
            resultsAnnouncement={t('search.count', { count: results.length })}
            emptyTitle={t('search.emptyTitle', { query: query.trim() })}
            emptyBody={t('search.emptyBody')}
            testID="SET-01.search"
          />
        </View>
      )}
      {loading ? <SettingsSkeleton member={status !== 'guest'} /> : query.trim() ? null : <SettingsList prefix="SET-01" />}
    </SettingsPage>
  );
}
