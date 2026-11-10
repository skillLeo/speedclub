import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TabRootScreen } from '@/features/shell/TabRootScreen';
import { createStyles, useBreakpoint } from '@/theme';

import { ViewAsUnavailable } from './ViewAsUnavailable';

const useStyles = createStyles((t) => ({
  body: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[32] },
}));

/**
 * The Nachrichten tab in a view-as tab (m3.2-contract §3): its title, and the designed "nicht verfügbar" state in place of the inbox,
 * every thread and request under it. Nothing of messaging mounts, so nothing asks the server for it.
 */
export function ViewAsMessagesScreen() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <TabRootScreen routeId="MSG-01" title={t('tabs.messages')}>
      <View style={[styles.body, { paddingHorizontal: gutter }]}>
        <ViewAsUnavailable kind="messages" testID="VIEWAS.messages" />
      </View>
    </TabRootScreen>
  );
}
