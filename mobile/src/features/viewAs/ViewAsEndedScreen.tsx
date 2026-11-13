import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles, layout, useBreakpoint } from '@/theme';
import { EmptyState, ErrorState, Screen, Text } from '@/ui';

import type { ViewAsEndReason } from './viewAsSession';

const useStyles = createStyles((t) => ({
  body: { flex: 1, justifyContent: 'center', paddingVertical: t.space[32] },
  column: { alignSelf: 'center', gap: t.space[16], maxWidth: layout.feedColumn, width: '100%' },
  // Under the empty state's button, centred like it.
  hint: { textAlign: 'center' },
}));

/** A tab that script opened (the admin's new tab) may close itself; any other one stays, with the hint under the button. */
function closeTab(): void {
  if (typeof window !== 'undefined') window.close?.();
}

const BODY: Readonly<Record<ViewAsEndReason, string>> = {
  ended: 'viewAs.endedBody',
  expired: 'viewAs.expiredBody',
  unavailable: 'viewAs.unavailableBody',
};

/**
 * "Ansicht beendet" (m3.2-contract §3): what a view-as tab shows once the view is over, by "Beenden", at expiry (401) or because the
 * account cannot be viewed. Nothing of the member stays loaded, and the tab never turns into this browser's own session.
 */
export function ViewAsEndedScreen({ reason }: { reason: ViewAsEndReason }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="VIEWAS.ended">
      <View style={[styles.body, { paddingHorizontal: gutter }]}>
        <View style={styles.column}>
          <EmptyState
            icon="eye-slash"
            title={t('viewAs.endedTitle')}
            body={t(BODY[reason] as never)}
            action={{ label: t('viewAs.closeTab'), onPress: closeTab, variant: 'secondary', size: 'm' }}
            testID={`VIEWAS.ended.${reason}`}
          />
          <Text variant="callout" color="text.secondary" style={styles.hint} testID="VIEWAS.ended.hint">
            {t('viewAs.closeHint')}
          </Text>
        </View>
      </View>
    </Screen>
  );
}

/** The start got no answer: the token is still in the tab, so a reload tries again. */
export function ViewAsFailedScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="VIEWAS.failed">
      <View style={[styles.body, { paddingHorizontal: gutter }]}>
        <View style={styles.column}>
          <ErrorState
            title={t('viewAs.failedTitle')}
            message={t('viewAs.failedBody')}
            onRetry={() => (typeof window !== 'undefined' ? window.location?.reload?.() : undefined)}
            testID="VIEWAS.failed.state"
          />
        </View>
      </View>
    </Screen>
  );
}
