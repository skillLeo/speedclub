import { useRouter, type Href } from 'expo-router';
import { use, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type FocusEvent, type LayoutChangeEvent } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { FormNotice } from '@/features/auth/components/FormNotice';
import { useTabScrollToTop } from '@/features/shell/retap';
import { TabBarOverlayContext, useHideTabBar, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { isWeb } from '@/lib/platform';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import {
  Button,
  DiscardGuardDialog,
  Header,
  OfflineBanner,
  Screen,
  StickyCTABar,
  useCollapsingHeader,
  type CollapsingHeader,
} from '@/ui';
import { NO_BROWSER_OUTLINE, useFocusRing } from '@/ui/useFocusRing';

import type { SettingsKey } from '../navigation';
import { SettingsSplit, useSettingsSplit } from './SettingsSplit';

const EDGES: readonly Edge[] = ['left', 'right'];
/** A focused field keeps this much air above the keyboard and the sticky bar. */
const KEYBOARD_OFFSET = size.button.l + size.touchMin;

const useStyles = createStyles((t) => ({
  box: { flex: 1 },
  scroll: { flex: 1, ...NO_BROWSER_OUTLINE },
  content: { flexGrow: 1, paddingTop: t.space[8] },
  // FS-12 on wide screens: one readable column. It starts on the gutter under the back control, as the profile's column does:
  // one desktop model for the whole tab (DQ-114). Its own bottom space stays when the tab bar padding replaces the content's.
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, paddingBottom: t.space[32], width: '100%' },
  // DQ-115: on wide screens the primary action stands right under its form.
  inlineCta: { marginTop: t.space[32] },
  readOnly: { marginBottom: t.space[16] },
}));

/**
 * The header's controls on wide screens: the column and the gutter on each side of it, so the title centres on the
 * content under it and back keeps its edge (DQ-135). The bar and its hairline still span the pane (DQ-144).
 */
export function settingsHeaderMaxWidth(gutter: number): number {
  return layout.feedColumn + 2 * gutter;
}

export type SettingsCta = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * §8 Destructive L (accent.fg text): stands under the form on every width, never in the sticky bar, so it is never the
   * first thing under the thumb. The filled red belongs to the final dialog.
   */
  destructive?: boolean;
};

export type SettingsPageProps = {
  /** Sets `<ROUTE-ID>.root`, `.header`, `.scroll`, `.offline`, `.cta` and `.discard`. */
  routeId: string;
  /** `headline` in the compact header. */
  title?: string;
  /**
   * For a page that prints `title` in its content: the header shows it only once that has scrolled away, after
   * `collapseAt` of this hook (§8, DQ-117). Without it the title stands in the header from the start.
   */
  collapsing?: CollapsingHeader;
  /** Where back goes after a direct link, when there is nothing to go back to. */
  fallback: Href;
  /** What the offline banner says on this page. */
  offlineLabel?: string;
  /**
   * Web: the scroller takes focus itself, for a page of text with nothing focusable in it, so the keyboard can scroll it
   * (WCAG 2.1.1). It draws the inset ring of ADR-118, and ends above the floating tab bar instead of under it: a focusable
   * box under the bar's buttons would overlap them.
   */
  focusableScroll?: boolean;
  /**
   * The row of SET-01 this page belongs to: on desktop the settings list stands beside it in a 280 pane with this row
   * selected. Undefined: no pane (SET-01 itself, which builds its own).
   */
  section?: SettingsKey | null;
  /** The pane's own row prefix and stacking, for SET-01 on desktop (SettingsSplit). */
  pane?: { prefix: string; replace: boolean };
  /**
   * A form: the scroller keeps the focused field above the keyboard, the tab bar hides (§9) and the primary action rides above
   * the keyboard in the sticky bar on a phone, inline under the form from 768 (DQ-115).
   */
  form?: { cta?: SettingsCta; dirty: boolean };
  /** Sheets and dialogs of the page, outside the scroller. */
  overlays?: ReactNode;
  /**
   * Scrolls once to this offset from the top of the content column, as soon as it is known: SET-18 opened on a section. Not for
   * forms, whose scroller follows the focused field.
   */
  scrollTarget?: number | null;
  children: ReactNode;
};

function HideTabBar() {
  useHideTabBar();
  return null;
}

/** A pushed page of the profile tab (§9): back, the offline banner, one scrolling column that clears the tab bar. */
export function SettingsPage({
  routeId,
  title,
  collapsing,
  fallback,
  offlineLabel,
  focusableScroll = false,
  section,
  pane,
  form,
  overlays,
  scrollTarget = null,
  children,
}: SettingsPageProps) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const motion = useMotionPreference();
  const { gutter, kind } = useBreakpoint();
  const wide = kind !== 'phone';
  const split = useSettingsSplit() && section !== undefined;
  const padding = useTabBarPadding();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const own = useCollapsingHeader();
  const header = collapsing ?? own;
  const ring = useFocusRing('inset');
  // Web: a scroller whose content is taller than it must be reachable by keyboard, whatever it holds now: a skeleton or a
  // restriction note holds nothing to focus (axe scrollable-region-focusable on SET-09 loading and SET-12 restricted, M2.8).
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflows = isWeb && viewport > 0 && contentHeight > viewport + 1;
  const focusable = isWeb && (focusableScroll || overflows);
  const barOverlay = use(TabBarOverlayContext);
  // Only a page of text ends above the bar; one that is focusable because it overflows keeps its layout.
  const above = isWeb && focusableScroll && barOverlay;
  // View-as (m3.2-contract §3): a form says it is read-only and its button rests; the server would refuse the save anyway.
  const readOnly = useViewAsReadOnly() && form !== undefined;
  const cta = form?.cta && readOnly ? { ...form.cta, disabled: true, loading: false } : form?.cta;
  const sticky = cta !== undefined && !cta.destructive && !wide;
  const [columnY, setColumnY] = useState<number | null>(null);
  const scrolledTo = useRef<number | null>(null);

  useEffect(() => {
    if (scrollTarget === null || columnY === null || scrolledTo.current === scrollTarget) return;
    scrolledTo.current = scrollTarget;
    scrollRef.current?.scrollTo({ y: Math.max(0, columnY + scrollTarget), animated: false });
  }, [columnY, scrollTarget]);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const column = (
    <View style={styles.column} onLayout={scrollTarget === null ? undefined : (event) => setColumnY(event.nativeEvent.layout.y)}>
      {readOnly ? (
        <View style={styles.readOnly}>
          <FormNotice tone="info" message={t('viewAs.formNotice')} testID={`${routeId}.viewAsReadOnly`} />
        </View>
      ) : null}
      {children}
      {cta && !sticky ? (
        <View style={styles.inlineCta} testID={`${routeId}.cta`}>
          <Button
            label={cta.label}
            size="l"
            variant={cta.destructive ? 'destructive' : 'primary'}
            fullWidth
            onPress={cta.onPress}
            loading={cta.loading}
            disabled={cta.disabled}
            testID={`${routeId}.cta.primary`}
          />
        </View>
      ) : null}
    </View>
  );

  // Both scrollers, the form's too: SET-12 restricted is a form whose scroller holds only text, its CTA in the sticky bar outside
  // it (axe scrollable-region-focusable, M2.8 round 2). Web: the role and the name stay from the first render, only the tab stop
  // follows the overflow. react-native-web renders role="region" as a <section>, so a role that arrived with the overflow turned
  // the <div> into a <section> and React remounted the whole page under it: an open sign-out dialog vanished with SET-01's state
  // (WebKit F1, M2.8 round 2).
  const scrollA11y = {
    ...(isWeb ? { role: 'region' as const, 'aria-label': title } : {}),
    ...(focusable ? { tabIndex: 0 as const } : {}),
    onLayout: isWeb ? (event: LayoutChangeEvent) => setViewport(event.nativeEvent.layout.height) : undefined,
    onContentSizeChange: isWeb ? (_width: number, height: number) => setContentHeight(height) : undefined,
    // Focus bubbles: a link or a field inside draws its own ring, this one is for the scroller alone.
    onFocus: (event: FocusEvent) => {
      if (event.target === event.currentTarget) ring.onFocus(event);
    },
    onBlur: ring.onBlur,
  };
  const contentStyle = [styles.content, { paddingHorizontal: gutter }];
  const scroller = form ? (
    // Its scroller is a Reanimated ScrollView, which runs the header's scroll handler on the UI thread (DQ-146).
    <KeyboardAwareScrollView
      {...header.scrollProps}
      {...scrollA11y}
      style={[styles.scroll, ring.ringStyle]}
      contentContainerStyle={[contentStyle, sticky ? null : padding]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={KEYBOARD_OFFSET}
      testID={`${routeId}.scroll`}
    >
      {column}
    </KeyboardAwareScrollView>
  ) : (
    <View style={[styles.box, above ? padding : null]}>
      <Animated.ScrollView
        ref={scrollRef}
        {...header.scrollProps}
        {...scrollA11y}
        style={[styles.scroll, ring.ringStyle]}
        contentContainerStyle={[contentStyle, above ? null : padding]}
        testID={`${routeId}.scroll`}
      >
        {column}
      </Animated.ScrollView>
    </View>
  );

  const page = (
    <>
      <Header
        variant={collapsing ? 'large' : 'compact'}
        title={title}
        scroll={header}
        // DQ-420: beside the list there is nothing to go back to, as in the MSG split; the pane is the way out.
        onBack={split ? undefined : () => (router.canGoBack() ? router.back() : router.replace(fallback))}
        contentMaxWidth={wide ? settingsHeaderMaxWidth(gutter) : undefined}
        testID={`${routeId}.header`}
      />
      {online ? null : <OfflineBanner label={offlineLabel} testID={`${routeId}.offline`} />}
      {scroller}
      {sticky && cta ? (
        <StickyCTABar
          label={cta.label}
          onPress={cta.onPress}
          loading={cta.loading}
          disabled={cta.disabled}
          testID={`${routeId}.cta`}
        />
      ) : null}
    </>
  );

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      {split ? (
        <SettingsSplit routeId={routeId} section={section ?? null} prefix={pane?.prefix} replace={pane?.replace}>
          {page}
        </SettingsSplit>
      ) : (
        page
      )}
      {form ? <HideTabBar /> : null}
      {form ? <DiscardGuardDialog dirty={form.dirty} testID={`${routeId}.discard`} /> : null}
      {overlays}
    </Screen>
  );
}
