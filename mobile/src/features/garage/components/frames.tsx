import type { Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import type { Edge } from 'react-native-safe-area-context';

import { useMe } from '@/api/queries/auth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { DecisionLink, useRestrictionDecision } from '@/features/safety/components/DecisionLink';
import { useHideTabBar, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useBack } from '@/features/vehicle/navigation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, size, useBreakpoint, useMotion } from '@/theme';
import {
  DiscardGuardDialog,
  EmptyState,
  ErrorState,
  Header,
  OfflineBanner,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  StickyCTABar,
  type StickyCTASecondary,
} from '@/ui';

const EDGES: readonly Edge[] = ['left', 'right'];
/** The column of a form: FS-5's 560 on wide screens, the full width minus the gutters on phones. */
export const FORM_MAX_WIDTH = 560;
/** A focused field keeps this much air above the keyboard and the sticky bar. */
const KEYBOARD_OFFSET = size.button.l + size.touchMin;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[16] },
  // DQ-156: from 768 the column starts on the gutter under back, as on PROF-03 and the settings pages (DQ-135, DQ-136).
  column: { alignSelf: 'flex-start', gap: t.space[24], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  centred: { flexGrow: 1, justifyContent: 'center' },
  skeletonField: { gap: t.space[8] },
  skeletonGroup: { gap: t.space[16] },
}));

export type GarageAccess = {
  status: 'loading' | 'guest' | 'member';
  /** Why writes are refused right now: a publishing restriction or a suspension (403 `account_restricted`). */
  restriction: string | null;
};

/** Who may use the garage: guests get the sign-in state, a restricted member reads but cannot change (§3.1, ADR-139). */
export function useGarageAccess(): GarageAccess {
  const { t } = useTranslation('garage');
  const format = useFormat();
  const qaState = useQaState();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const viewAs = useViewAsReadOnly();
  const viewAsT = useTranslation('auth').t;
  if (qaState === 'restricted') return { status: 'member', restriction: t('restricted.body') };
  // M3.5: a read-only view as a member reads the garage as the member does, and every write control shows why it is off.
  if (viewAs) return { status, restriction: viewAsT('viewAs.readOnly') };
  const restrictions = me.data?.restrictions;
  let restriction: string | null = null;
  if (restrictions?.suspended) restriction = t('restricted.suspended');
  else if (restrictions?.publishing.restricted) {
    restriction = restrictions.publishing.until
      ? t('restricted.until', { date: format.dateTime(new Date(restrictions.publishing.until)) })
      : t('restricted.body');
  }
  return { status, restriction };
}

/** The restricted state of a garage write, with "Begründung ansehen" when a decision stands behind it (M2.6, SAFE-01). */
export function RestrictedNotice({ message, testID }: { message: string; testID: string }) {
  const decisionId = useRestrictionDecision('publishing');
  const viewAs = useViewAsReadOnly();
  const viewAsT = useTranslation('auth').t;
  // The view-as reason replaces any other: the staff member cannot act on the member's decision from here.
  if (viewAs) return <FormNotice message={viewAsT('viewAs.readOnly')} tone="info" testID={testID} />;
  if (!decisionId) return <FormNotice message={message} tone="info" testID={testID} />;
  return (
    <View>
      <FormNotice message={message} tone="info" testID={testID} />
      <DecisionLink decisionId={decisionId} testID={`${testID}.decision`} />
    </View>
  );
}

/** A guest on a garage route: one invitation, and back here after signing in. */
export function SignInState({ routeId, returnTo }: { routeId: string; returnTo: string }) {
  const { t } = useTranslation('garage');
  const requireAuth = useRequireAuth();
  return (
    <EmptyState
      icon="garage"
      title={t('guest.title')}
      body={t('guest.body')}
      action={{ label: t('guest.signIn'), onPress: () => requireAuth(undefined, { returnTo }) }}
      testID={`${routeId}.guest`}
    />
  );
}

/** A vehicle or mod the member no longer has (deleted on another device, or never theirs). */
export function GoneState({ routeId, title, body }: { routeId: string; title: string; body: string }) {
  const { t } = useTranslation('garage');
  const back = useBack('/garage');
  return (
    <EmptyState
      icon="wrench"
      title={title}
      body={body}
      action={{ label: t('gone.toGarage'), onPress: back, variant: 'secondary', size: 'm' }}
      testID={`${routeId}.notFound`}
    />
  );
}

/** Offline without a copy, or an error, with the retry. */
export function LoadErrorState({ routeId, onRetry, retrying, offline }: { routeId: string; onRetry: () => void; retrying: boolean; offline: boolean }) {
  const { t } = useTranslation('garage');
  return (
    <ErrorState
      title={offline ? t('error.offlineTitle') : t('error.title')}
      message={offline ? t('error.offlineBody') : undefined}
      onRetry={onRetry}
      retrying={retrying}
      testID={`${routeId}.${offline ? 'offline' : 'error'}`}
    />
  );
}

/** The skeleton of a form: groups of label + 52 field, the geometry of FS-5. */
export function FormSkeleton({ routeId, groups = [3, 2] }: { routeId: string; groups?: readonly number[] }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${routeId}.skeleton`}>
      <View style={styles.column}>
        {groups.map((fields, group) => (
          <View key={group} style={styles.skeletonGroup}>
            <SkeletonText variant="eyebrow" width="25%" />
            {Array.from({ length: fields }, (_, index) => (
              <View key={index} style={styles.skeletonField}>
                <SkeletonText variant="labelS" width="35%" />
                <SkeletonBlock height={size.input} corner="sm" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/**
 * DQ-156, one model for every pushed screen of the garage, the vehicle pages and the QR pages (M1.5's DQ-135 and DQ-136):
 * from 768 the content column starts on the gutter under back, and the header's controls keep to that column and its two
 * gutters, so back stands on the column's edge, the title centres on it and a header action ends where the column ends.
 * The bar and its hairline still span the pane (DQ-144). `column` is the content width without the gutters.
 */
export function usePushedHeaderWidth(column: number): number | undefined {
  const { gutter, kind } = useBreakpoint();
  return kind === 'phone' ? undefined : column + 2 * gutter;
}

/** The pane beside the rail or the sidebar, before it is measured. */
export function estimatedPaneWidth(windowWidth: number, kind: 'phone' | 'tablet' | 'desktop'): number {
  if (kind === 'desktop') return windowWidth - layout.sidebar;
  if (kind === 'tablet') return windowWidth - layout.rail;
  return windowWidth;
}

export type EditorScreenProps = {
  routeId: string;
  title: string;
  /** Where back leads after a direct link. */
  fallback: Href;
  /** Header text action, FS-6's "Speichern". */
  trailing?: ReactNode;
  /** Replaces the common offline copy. */
  offlineLabel?: string;
  children: ReactNode;
};

/**
 * The frame of an editor pushed inside the Garage tab (GAR-05 to GAR-12): compact header with back, offline banner, and the
 * tab bar hidden while it is focused (§9).
 */
export function EditorScreen({ routeId, title, fallback, trailing, offlineLabel, children }: EditorScreenProps) {
  useHideTabBar();
  const online = useOnline();
  const back = useBack(fallback);
  const headerWidth = usePushedHeaderWidth(FORM_MAX_WIDTH);
  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header title={title} onBack={back} trailing={trailing} contentMaxWidth={headerWidth} testID={`${routeId}.header`} />
      {online ? null : <OfflineBanner label={offlineLabel} testID={`${routeId}.offlineBanner`} />}
      {children}
    </Screen>
  );
}

/** A state in the middle of an editor or list: it scrolls when a large font makes it taller than the screen. */
export function CentredState({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const padding = useTabBarPadding();
  const { gutter } = useBreakpoint();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.centred, { paddingHorizontal: gutter }, padding]}>
      {children}
    </ScrollView>
  );
}

/**
 * The loading body of an editor: the form skeleton, or a screen's own skeleton (`children`, DQ-207) in the same padding.
 * A screen's own skeleton brings its `Skeleton` wrapper with the `<routeId>.skeleton` test ID.
 */
export function EditorLoading({ routeId, groups, children }: { routeId: string; groups?: readonly number[]; children?: ReactNode }) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <View style={[styles.content, { paddingHorizontal: gutter }]}>
      {children ?? <FormSkeleton routeId={routeId} groups={groups} />}
    </View>
  );
}

export type EditorFormProps = {
  routeId: string;
  children: ReactNode;
  cta: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; secondary?: StickyCTASecondary };
  /** While true, every way back asks first (§9). */
  dirty: boolean;
  /** Runs before a discarded edit leaves. */
  onDiscard?: () => void;
  /**
   * A notice at the top of the form that no field can show, such as the held session's (BH-30) or a save's reason: when it
   * appears or changes, the form scrolls up to it, because a member who saved from the bottom would otherwise see nothing.
   */
  revealTop?: string | null;
  /**
   * DQ-251: a group just added at the end of the form, such as GAR-10's "Weitere Angaben". When it is set or changes, the form
   * scrolls to its end after the next frame, once the group is drawn and its field has the focus. Focusing alone brings the input
   * to the scroller's edge and leaves its error under the sticky bar; the end shows the field, its error and what follows.
   */
  revealEnd?: unknown;
};

/**
 * The scrolling form with the sticky CTA bar riding above the keyboard (§9) and the discard guard. The column is 560 wide
 * at most and centred; the bar lines its button up with it.
 */
export function EditorForm({ routeId, children, cta, dirty, onDiscard, revealTop = null, revealEnd = null }: EditorFormProps) {
  const styles = useStyles();
  const motion = useMotion();
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const animated = motion.enabled && !motion.reduced;
  useEffect(() => {
    if (revealTop) scroll.current?.scrollTo({ y: 0, animated });
  }, [animated, revealTop]);
  useEffect(() => {
    if (revealEnd === null || revealEnd === undefined) return undefined;
    // After the focus, which the screen gives in its own effect of this commit: the end wins over the input's edge.
    const frame = requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated }));
    return () => cancelAnimationFrame(frame);
  }, [animated, revealEnd]);
  const { gutter, kind, width } = useBreakpoint();
  const [pane, setPane] = useState(0);
  const paneWidth = pane || estimatedPaneWidth(width, kind);
  // The bar's own view is exempt from the spacing audit (safe area): its button row starts on the gutter and ends where
  // the column ends (DQ-156).
  const barPadding = { paddingLeft: gutter, paddingRight: Math.max(gutter, paneWidth - gutter - FORM_MAX_WIDTH) };
  return (
    <>
      <KeyboardAwareScrollView
        ref={scroll}
        onLayout={(event) => setPane(event.nativeEvent.layout.width)}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={KEYBOARD_OFFSET}
        testID={`${routeId}.scroll`}
      >
        <View style={styles.column}>{children}</View>
      </KeyboardAwareScrollView>
      <StickyCTABar
        label={cta.label}
        onPress={cta.onPress}
        loading={cta.loading}
        disabled={cta.disabled}
        secondary={cta.secondary}
        style={barPadding}
        testID={`${routeId}.cta`}
      />
      <DiscardGuardDialog dirty={dirty} onDiscard={onDiscard} testID={`${routeId}.discard`} />
    </>
  );
}


const headerStyles = StyleSheet.create({ action: { alignSelf: 'center' } });

/** A text action in the header ("Sortieren", "Fertig", FS-6's "Speichern"), centred on the 44 row like the icon buttons. */
export const HEADER_TEXT_ACTION = headerStyles.action;
