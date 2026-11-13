import { useLiveMessagingBadges } from '@/features/messages/useLiveMessagingBadges';
import { JsTabsLayout } from '@/features/shell/JsTabsLayout';
import { useTabChrome } from '@/features/shell/navMode';
import { NativeTabsLayout } from '@/features/shell/NativeTabsLayout';

/**
 * iOS and Android (09 §6.1): native tabs behind `nav.native_tabs` (on by default, §8.18), the JS shell as the fallback.
 * The web resolves `_layout.tsx` instead.
 */
export default function TabsLayout() {
  // With realtime on, the tab badges follow private-user.{id} everywhere; without it the 60 s badge poll stays (M2.4).
  useLiveMessagingBadges();
  return useTabChrome() === 'native' ? <NativeTabsLayout /> : <JsTabsLayout />;
}
