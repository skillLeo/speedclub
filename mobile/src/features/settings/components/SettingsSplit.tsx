import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { createStyles, layout, useBreakpoint } from '@/theme';
import { Text } from '@/ui';

import type { SettingsKey } from '../navigation';
import { SettingsList } from './SettingsList';

const useStyles = createStyles((t) => ({
  split: { backgroundColor: t.color.bg.canvas, flex: 1, flexDirection: 'row' },
  pane: {
    borderRightColor: t.color.border.subtle,
    borderRightWidth: t.size.border.control,
    flexShrink: 0,
    width: layout.settingsPane,
  },
  paneContent: { gap: t.space[16], paddingBottom: t.space[32], paddingHorizontal: t.space[16], paddingTop: t.space[16] },
  // The pane's title sits where the header's would, in the header's height.
  paneTitle: { justifyContent: 'center', minHeight: t.size.header, paddingHorizontal: t.space[16] },
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
 * Desktop: the settings list stands in a 280 pane beside the page, and a row there swaps the detail. Below 1280 the page
 * renders alone, as on a phone. Same components, never a second design (§12).
 */
export function SettingsSplit({ routeId, section, prefix = `${routeId}.nav`, replace = true, children }: SettingsSplitProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const split = useSettingsSplit();
  if (!split) return children;
  return (
    <View style={styles.split}>
      <View style={styles.pane} role="navigation" aria-label={t('title')} testID={`${routeId}.nav`}>
        <View style={styles.paneTitle}>
          <Text variant="headline" role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('title')}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.paneContent}>
          <SettingsList prefix={prefix} selected={section} replace={replace} compact />
        </ScrollView>
      </View>
      <View style={styles.detail}>{children}</View>
    </View>
  );
}
