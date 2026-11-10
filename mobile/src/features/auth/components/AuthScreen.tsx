import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import type { Edge } from 'react-native-safe-area-context';

import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, space, useBreakpoint } from '@/theme';
import {
  Button,
  DiscardGuardDialog,
  Header,
  OfflineBanner,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  StickyCTABar,
  Text,
  useCollapsingHeader,
  type StickyCTASecondary,
} from '@/ui';

import { FormNotice } from './FormNotice';

/** The column of a form on wide screens: wide enough for a German label beside a checkbox, narrow enough to read as a form. */
const FORM_MAX_WIDTH = layout.inboxPane + space[64];
const EDGES: readonly Edge[] = ['left', 'right'];
/** A focused field keeps this much air above the keyboard and the sticky bar. */
const KEYBOARD_OFFSET = space[64] + space[32];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[8] },
  column: { alignSelf: 'center', maxWidth: FORM_MAX_WIDTH, width: '100%' },
  heading: { gap: t.space[8], marginBottom: t.space[24] },
  body: { gap: t.space[16] },
  // DQ-115: the primary action right under its form, where a sticky bar would leave it far below on a tall window.
  inlineActions: { gap: t.space[8], marginTop: t.space[24] },
  footer: { marginTop: t.space[24] },
  skeletonFields: { gap: t.space[16] },
  skeletonField: { gap: t.space[8] },
  // Measures the labels of the sticky bar on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
}));

export type AuthScreenProps = {
  routeId: string;
  title: string;
  subtitle?: string;
  /**
   * False for a subtitle whose long word already carries a hard hyphen: "Authenticator-App" broke as "Authenti- / cator-App"
   * (DQ-440). It then wraps at its spaces and that hyphen only.
   */
  subtitleHyphenate?: boolean;
  /**
   * A step of signing in (AUTH-03, AUTH-11): a restricted account may still sign in, so its forced restricted state says that in
   * the info tone, not that the function is unavailable (DQ-437).
   */
  signInStep?: boolean;
  children?: ReactNode;
  /** Under the fields: links to the neighbouring screens. */
  footer?: ReactNode;
  cta?: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean };
  secondary?: StickyCTASecondary;
  /** `null`: no way back, for the steps a member has to finish. By default back, or Home after a direct link. */
  onBack?: (() => void) | null;
  headerTrailing?: ReactNode;
  /**
   * While true, leaving asks first (§9). False while the form is being sent and after it succeeded: the way on after a
   * success (a replace, or the session routing) must not run into the guard.
   */
  dirty?: boolean;
  /** How many fields the skeleton draws. */
  skeletonFields?: number;
  /** Replaces the fields of the skeleton where they are not plain inputs, as the code cells. */
  skeleton?: ReactNode;
};

/**
 * DQ-112: whether the primary of the sticky bar needs a line of its own. Beside the secondary it gets the rest of the row;
 * a label that does not fit there on one line would wrap and grow the button past 52, so the bar stacks instead.
 */
export function barNeedsStack(rowWidth: number, primaryLabel: number, secondaryLabel: number): boolean {
  if (rowWidth <= 0 || primaryLabel <= 0) return false;
  // The padding token holds the border (§8, Button).
  const secondary = secondaryLabel + 2 * size.buttonPaddingX.s;
  const primary = Math.max(rowWidth / 2, rowWidth - secondary - space[8]);
  return primaryLabel > primary - 2 * size.buttonPaddingX.l;
}

/**
 * DQ-115, DQ-146: from the tablet on, the header's controls stand on the edges of the form's column, not in the window
 * corners. The header pads itself in to that column, so its ground and the hairline still span the window (DQ-144).
 */
export function authHeaderInset(width: number, gutter: number): number {
  return Math.max(0, (width - FORM_MAX_WIDTH - 2 * gutter) / 2);
}

/** What every form of the auth stack shares: header, offline banner, the column, the CTA and the forced QA states. */
export function AuthScreen({
  routeId,
  title,
  subtitle,
  subtitleHyphenate = true,
  signInStep = false,
  children,
  footer,
  cta,
  secondary,
  onBack,
  headerTrailing,
  dirty = false,
  skeletonFields = 2,
  skeleton,
}: AuthScreenProps) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const { gutter, kind, width } = useBreakpoint();
  const online = useOnline();
  const qaState = useQaState();
  // §8: the bar stays compact; its hairline fades in once the form scrolls under it, as on the settings pages (DQ-146).
  const header = useCollapsingHeader();
  const [labels, setLabels] = useState({ primary: 0, secondary: 0 });
  const wide = kind !== 'phone';
  const loading = qaState === 'loading';
  const barPadding = { paddingHorizontal: Math.max(gutter, (width - FORM_MAX_WIDTH) / 2) };
  const stacked =
    Boolean(cta && secondary) && barNeedsStack(width - 2 * barPadding.paddingHorizontal, labels.primary, labels.secondary);

  const back =
    onBack === null ? undefined : (onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/'))));
  // DQ-131: nothing to send while the form is still a skeleton.
  const ctaDisabled = Boolean(cta?.disabled) || loading;
  const secondaryAction = secondary ? { ...secondary, disabled: Boolean(secondary.disabled) || loading } : undefined;
  const measured = (key: 'primary' | 'secondary') => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setLabels((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header
        onBack={back}
        trailing={headerTrailing}
        scroll={header}
        style={wide ? { paddingHorizontal: authHeaderInset(width, gutter) } : undefined}
        testID={`${routeId}.header`}
      />
      {online ? null : <OfflineBanner label={t('common.offline')} testID={`${routeId}.offline`} />}
      {/* Its scroller is a Reanimated ScrollView, which runs the header's scroll handler on the UI thread. */}
      <KeyboardAwareScrollView
        {...header.scrollProps}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={KEYBOARD_OFFSET}
        testID={`${routeId}.scroll`}
      >
        <View style={styles.column}>
          {loading ? (
            <Skeleton testID={`${routeId}.skeleton`}>
              <View style={styles.heading}>
                <SkeletonText variant="titleL" width="70%" />
                {subtitle ? <SkeletonText variant="body" lines={2} /> : null}
              </View>
              <View style={styles.skeletonFields}>
                {skeleton}
                {Array.from({ length: skeletonFields }, (_, index) => (
                  <View key={index} style={styles.skeletonField}>
                    <SkeletonText variant="labelS" width="30%" />
                    <SkeletonBlock height={size.input} corner="sm" />
                  </View>
                ))}
              </View>
            </Skeleton>
          ) : (
            <>
              <View style={styles.heading}>
                <Text variant="titleL" role="heading" testID={`${routeId}.title`}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="body" color="text.secondary" hyphenate={subtitleHyphenate} testID={`${routeId}.subtitle`}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <View style={styles.body}>
                {qaState === 'error' ? <FormNotice message={t('common.serverError')} testID={`${routeId}.notice`} /> : null}
                {qaState === 'restricted' ? (
                  signInStep ? (
                    <FormNotice message={t('common.restrictedSignIn')} tone="info" testID={`${routeId}.notice`} />
                  ) : (
                    <FormNotice message={t('common.restricted')} testID={`${routeId}.notice`} />
                  )
                ) : null}
                {children}
              </View>
            </>
          )}
          {cta && wide ? (
            <View style={styles.inlineActions} testID={`${routeId}.cta`}>
              <Button
                label={cta.label}
                size="l"
                fullWidth
                onPress={cta.onPress}
                loading={cta.loading}
                disabled={ctaDisabled}
                testID={`${routeId}.cta.primary`}
              />
              {secondaryAction ? (
                <Button
                  label={secondaryAction.label}
                  variant="tertiary"
                  size="m"
                  fullWidth
                  onPress={secondaryAction.onPress}
                  loading={secondaryAction.loading}
                  disabled={secondaryAction.disabled}
                  testID={secondaryAction.testID}
                />
              ) : null}
            </View>
          ) : null}
          {footer && !loading ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAwareScrollView>
      {cta && !wide ? (
        <StickyCTABar
          label={cta.label}
          onPress={cta.onPress}
          loading={cta.loading}
          disabled={ctaDisabled}
          secondary={secondaryAction}
          stacked={stacked}
          style={barPadding}
          testID={`${routeId}.cta`}
        />
      ) : null}
      {cta && secondary && !wide ? (
        <View aria-hidden style={styles.measure}>
          <Text variant="label" hyphenate={false} selectable={false} onLayout={measured('primary')}>
            {cta.label}
          </Text>
          <Text variant="labelS" hyphenate={false} selectable={false} onLayout={measured('secondary')}>
            {secondary.label}
          </Text>
        </View>
      ) : null}
      <DiscardGuardDialog dirty={dirty} testID={`${routeId}.discard`} />
    </Screen>
  );
}

/** "Noch kein Konto?" + link. Wraps at a large font instead of squeezing the link; pass the link `flush="start"`. */
export function FooterLink({ text, children }: { text?: string; children: ReactNode }) {
  const styles = useFooterStyles();
  return (
    <View style={styles.row}>
      {text ? (
        <Text variant="supporting" color="text.secondary" style={styles.text}>
          {text}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const useFooterStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space[4] },
  text: { flexShrink: 1 },
}));
