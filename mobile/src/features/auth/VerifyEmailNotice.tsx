import { usePathname, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { isWeb } from '@/lib/platform';
import { dropBareReturnTo, keepReturnTo, useSessionStore } from '@/state/session';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Icon, Text } from '@/ui';
import { RowBody, useStacksAtFontScale } from '@/ui/rowParts';
import { useSafeEdge } from '@/ui/safeArea';

import { deepLinkOf, isBrowsePath, STEP_ROUTE } from './routing';

const useStyles = createStyles((t) => ({
  // As the offline banner: a band of bg.raised with the supporting text, here at the foot of the content. The hairline on top
  // parts it from the content above, as the tab bar and the sticky bars do: in Light, bg.raised is close to the canvas.
  band: {
    alignSelf: 'stretch',
    backgroundColor: t.color.bg.raised,
    borderTopColor: t.color.border.subtle,
    borderTopWidth: isWeb ? t.size.border.control : StyleSheet.hairlineWidth,
  },
  // One row, at every width and font size: the text is chosen to fit one line, and the action keeps its size.
  row: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', minHeight: size.touchMin, paddingVertical: t.space[8] },
  text: { flexGrow: 1, flexShrink: 1 },
  action: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexShrink: 0 },
}));

/**
 * BH-29: an unverified member browses (02_PRODUCT_SPEC §3.1), and this says what the code is for. Persistent, and only on the
 * browse paths: everywhere else the routing has already taken the member to AUTH-05. `tabBarOverlay`: the floating tab bar lies
 * over the foot of the content, so this stops above it.
 *
 * Chrome that recedes (§15): a single pressable row of one line, at least 44 high, never a block over the photos. It wraps and
 * never truncates (§4, DQ-250), so the text is chosen by the room there is: the full sentence only in the desktop layout at up to
 * the stacking font scale, where it fits beside "Code eingeben" (652 of 857 px at 1280), and the short "E-Mail bestätigen"
 * everywhere else. Above the stacking scale the visible label goes too and the caret is the action. Two lines are the safety
 * net, never an ellipsis.
 *
 * The row's accessible name (WCAG 2.5.3, label in name): on web it is the visible text, read from the row's content, so the
 * text plus "Code eingeben" when that shows. On native it starts with the visible text too: with the full sentence shown, the
 * sentence plus the action; with the short text shown, the short text, then the full sentence, so a screen reader still hears
 * what the code is for, then the action, which the caret stands for when the label is gone.
 */
export function VerifyEmailNotice({ tabBarOverlay = false }: { tabBarOverlay?: boolean }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const { gutter, kind } = useBreakpoint();
  const stacks = useStacksAtFontScale();
  const short = kind !== 'desktop' || stacks;
  const unverified = useSessionStore((state) => state.status === 'member' && state.member?.nextStep === 'verify_email');
  const footPadding = useSafeEdge('bottom', tabBarOverlay ? size.tabBar : 0);
  if (!unverified || !isBrowsePath(pathname)) return null;

  const visible = short ? t('verifyNotice.short') : t('verifyNotice.body');
  // RowBody passes this on native only; web names the row from its content, which is the visible text.
  const label = short
    ? `${visible}. ${t('verifyNotice.body')} ${t('verifyNotice.action')}`
    : `${visible} ${t('verifyNotice.action')}`;

  const openVerify = () => {
    // This page comes back after the steps, once. The tap is the member's latest choice, so it replaces a path kept earlier, and
    // a page with nothing to come back to (Home) forgets that path.
    const resume = deepLinkOf(pathname);
    if (resume) keepReturnTo(resume, { replaceBare: true });
    else dropBareReturnTo();
    router.push(STEP_ROUTE.verify_email as Href);
  };

  return (
    <View role="status" style={[styles.band, footPadding]} testID="shell.verifyNotice">
      <RowBody
        role="button"
        label={label}
        onPress={openVerify}
        style={[styles.row, { paddingLeft: gutter, paddingRight: gutter }]}
        testID="shell.verifyNotice.action"
      >
        <Text variant="callout" numberOfLines={2} hyphenate={false} style={styles.text} testID="shell.verifyNotice.text">
          {visible}
        </Text>
        <View style={styles.action}>
          {stacks ? null : (
            <Text variant="bodyStrong" numberOfLines={1} hyphenate={false} selectable={false}>
              {t('verifyNotice.action')}
            </Text>
          )}
          <Icon name="caret-right" size={16} color="text.tertiary" />
        </View>
      </RowBody>
    </View>
  );
}
