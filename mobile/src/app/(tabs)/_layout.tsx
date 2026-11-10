import { TabList, Tabs, TabTrigger } from 'expo-router/ui';
import { StyleSheet } from 'react-native';

import { useLiveMessagingBadges } from '@/features/messages/useLiveMessagingBadges';
import { ShellFrame } from '@/features/shell/ShellFrame';
import { WebShortcuts } from '@/features/shell/shortcuts/WebShortcuts';

const styles = StyleSheet.create({ routes: { display: 'none' } });

/**
 * Headless tabs (ADR-019). The hidden TabList only defines the five routes; the visible bars in ShellFrame use
 * name-only triggers (docs.expo.dev/router/advanced/custom-tabs, "Multiple tab bars").
 */
export default function TabsLayout() {
  // With realtime on, the tab badges follow private-user.{id} everywhere; without it the 60 s badge poll stays (M2.4).
  useLiveMessagingBadges();
  return (
    <Tabs>
      <TabList style={styles.routes}>
        <TabTrigger name="home" href="/(tabs)/(home)" />
        <TabTrigger name="discover" href="/(tabs)/(discover)/discover" />
        <TabTrigger name="garage" href="/(tabs)/(garage)/garage" />
        <TabTrigger name="messages" href="/(tabs)/(messages)/messages" />
        <TabTrigger name="profile" href="/(tabs)/(profile)/profile" />
      </TabList>
      <ShellFrame />
      {/* [SIG] sig.web_shortcuts, desktop web only; inside Tabs because it switches tabs (M2.7). */}
      <WebShortcuts />
    </Tabs>
  );
}
