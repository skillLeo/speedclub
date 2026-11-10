import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TabRootScreen } from '@/features/shell/TabRootScreen';
import { createStyles } from '@/theme';
import { EmptyState } from '@/ui';

import { useMessaging } from '../data';

import { InboxScreen } from './MessagingScreens';

const ROUTE = 'MSG-01';

const useStyles = createStyles((t) => ({
  centre: { flexGrow: 1, justifyContent: 'center', paddingBottom: t.space[48] },
}));

/**
 * MSG-01 /messages in APK #1 (register: "P1 placeholder → P2"): one designed, honest state. No sample conversation, no
 * request count, no composer: messaging arrives with Phase 2, and guests see the same.
 */
function ComingSoon() {
  const { t } = useTranslation('messages');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  return (
    <TabRootScreen routeId={ROUTE} title={common('tabs.messages')} offlineLabel={t('offline')} bodyTestID="screen.messages">
      <View style={styles.centre}>
        <EmptyState
          variant="brand"
          icon="chats"
          title={t('soon.title')}
          body={t('soon.body')}
          action={{ label: t('soon.action'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.soon`}
        />
      </View>
    </TabRootScreen>
  );
}

/**
 * MSG-01: the inbox once the messaging API is wired (`MessagingContext` holds a real adapter); until then the P1 placeholder,
 * so the tab never shows a half-working inbox.
 */
export function MessagesScreen() {
  const adapter = useMessaging();
  return adapter.available ? <InboxScreen /> : <ComingSoon />;
}
