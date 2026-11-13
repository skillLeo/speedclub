import { TabList, Tabs, TabTrigger } from 'expo-router/ui';
import { StyleSheet } from 'react-native';

import { ShellFrame } from './ShellFrame';
import { WebShortcuts } from './shortcuts/WebShortcuts';

const styles = StyleSheet.create({ routes: { display: 'none' } });

/**
 * Headless tabs (ADR-019): the web shell, and native's fallback while `nav.native_tabs` is off (09 §6.1). The hidden TabList
 * only defines the five routes; the visible bars in ShellFrame (floating bar < 768, rail 768–1279, sidebar ≥ 1280) use
 * name-only triggers (docs.expo.dev/router/advanced/custom-tabs, "Multiple tab bars").
 */
export function JsTabsLayout() {
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
