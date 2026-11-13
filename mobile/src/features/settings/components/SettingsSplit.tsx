import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { useSessionStore } from '@/state/session';
import { createStyles, useBreakpoint, useTheme } from '@/theme';
import { isWeb } from '@/lib/platform';
import { SettingsSearch, Text } from '@/ui';
import { useDesktopType } from '@/ui/Text';

import type { SettingsKey } from '../navigation';
import { PANE_PADDING, PANE_TITLE_ROLE, settingsPaneLabels, settingsPaneWidth } from '../paneWidth';
import { initialSearchQuery, searchSettings } from '../search';
import { appVersionInfo } from '../version';
import { SettingsList, useSettingsFlags } from './SettingsList';

const useStyles = createStyles((t) => ({
  split: { backgroundColor: t.color.bg.canvas, flex: 1, flexDirection: 'row' },
  pane: {
    borderRightColor: t.color.border.subtle,
    borderRightWidth: t.size.border.control,
    flexShrink: 0,
  },
  paneContent: { gap: t.space[16], paddingBottom: t.space[32], paddingHorizontal: PANE_PADDING, paddingTop: t.space[16] },
  // The pane's title sits where the header's would, in the header's height.
  paneTitle: { justifyContent: 'center', minHeight: t.size.header, paddingHorizontal: PANE_PADDING },
  detail: { flex: 1, minWidth: 0 },
}));

/** Whether this window shows the settings as list + detail (FS-12, AUTH-11 desktop: 280 list + detail from 1280). */
export function useSettingsSplit(): boolean {
  return useBreakpoint().kind === 'desktop';
}

export type SettingsSplitProps = {
  /** The route of the detail; the pane's rows are `<routeId>.nav.<row>`. */
  routeId: string;
  /** The row of the detail, highlighted in the pane. */
  section: SettingsKey | null;
  /** testID prefix of the pane's rows; `<routeId>.nav` by default. SET-01 keeps its own. */
  prefix?: string;
  /** A row swaps the detail (the default) or, on SET-01, stacks it so back returns to the list. */
  replace?: boolean;
  children: ReactNode;
};

/**
 * A12: the pane's width at this font scale, 280 until a label's longest word would no longer fit its column (paneWidth.ts).
 */
function usePaneWidth(): number {
  const { t } = useTranslation('settings');
  const { fontScale } = useTheme();
  const desktop = useDesktopType();
  const member = useSessionStore((state) => state.status === 'member');
  return settingsPaneWidth(settingsPaneLabels(t, member, appVersionInfo()), fontScale, desktop);
}

/**
 * Desktop: the settings list stands in a 280 pane beside the page, and a row there swaps the detail. Below 1280 the page
 * renders alone, as on a phone. Same components, never a second design (§12). At a large font the pane grows until every
 * label's longest word fits its column (A12), so no word breaks between two letters.
 */
export function SettingsSplit({ routeId, section, prefix = `${routeId}.nav`, replace = true, children }: SettingsSplitProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const split = useSettingsSplit();
  const width = usePaneWidth();
  const router = useRouter();
  const flags = useSettingsFlags();
  const member = useSessionStore((state) => state.status === 'member');
  const [query, setQuery] = useState(initialSearchQuery);
  if (!split) return children;
  // SET-26 on desktop: the search heads the pane, and its matches replace the pane's list while it holds a query.
  const results = searchSettings(query, t, { member, web: isWeb, flags }).map((result) => ({
    ...result,
    onPress: () => {
      setQuery('');
      router.replace(result.path);
    },
  }));
  return (
    <View style={styles.split}>
      <View style={[styles.pane, { width }]} role="navigation" aria-label={t('title')} testID={`${routeId}.nav`}>
        <View style={styles.paneTitle}>
          <Text variant={PANE_TITLE_ROLE} role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('title')}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.paneContent}>
          <SettingsSearch
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            results={results}
            resultsAnnouncement={t('search.count', { count: results.length })}
            emptyTitle={t('search.emptyTitle', { query: query.trim() })}
            emptyBody={t('search.emptyBody')}
            testID={`${prefix}.search`}
          />
          {query.trim() ? null : <SettingsList prefix={prefix} selected={section} replace={replace} compact />}
        </ScrollView>
      </View>
      <View style={styles.detail}>{children}</View>
    </View>
  );
}
