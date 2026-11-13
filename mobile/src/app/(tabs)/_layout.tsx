import { useLiveMessagingBadges } from '@/features/messages/useLiveMessagingBadges';
import { JsTabsLayout } from '@/features/shell/JsTabsLayout';

/**
 * Web: always the JS shell (09 §6.1). Native has `_layout.native.tsx`, so the web bundle never imports native tabs.
 */
export default function TabsLayout() {
  // With realtime on, the tab badges follow private-user.{id} everywhere; without it the 60 s badge poll stays (M2.4).
  useLiveMessagingBadges();
  return <JsTabsLayout />;
}
