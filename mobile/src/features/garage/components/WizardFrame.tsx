import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import type { Edge } from 'react-native-safe-area-context';

import { useOnline } from '@/state/online';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import {
  DiscardGuardDialog,
  Hairline,
  Header,
  Icon,
  OfflineBanner,
  PressableScale,
  Progress,
  Screen,
  StickyCTABar,
  Text,
  VehicleCard,
  type StickyCTASecondary,
  type VehicleCardProps,
} from '@/ui';
import { SECTION_HEADER_ROLE } from '@/ui/RowGroup';

import { stepNumber, WIZARD_STEPS, type WizardStep } from '../model';
import { useCloseModal, wizardPath } from '../navigation';
import { FORM_MAX_WIDTH } from './frames';

const EDGES: readonly Edge[] = ['left', 'right'];
const KEYBOARD_OFFSET = size.button.l + size.touchMin;
/** FS-5 desktop: steps rail 240 · form up to 560 · live preview. */
const RAIL_WIDTH = layout.sidebar;
const PREVIEW_WIDTH = 320;

const useStyles = createStyles((t) => ({
  caption: { gap: t.space[8], paddingBottom: t.space[12], paddingTop: t.space[4] },
  body: { flex: 1 },
  desktop: { flex: 1, flexDirection: 'row' },
  rail: { borderRightColor: t.color.border.subtle, borderRightWidth: t.size.border.control, gap: t.space[4], padding: t.space[24], width: RAIL_WIDTH },
  railItem: { alignItems: 'center', borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[12], minHeight: t.size.touchMin, paddingHorizontal: t.space[12] },
  railCurrent: { backgroundColor: t.color.bg.raised },
  railIndex: {
    alignItems: 'center',
    borderColor: t.color.border.default,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
    height: t.size.avatar.xs,
    justifyContent: 'center',
    width: t.size.avatar.xs,
  },
  railIndexDone: { backgroundColor: t.color.bg.inverse, borderColor: t.color.bg.inverse },
  railLabel: { flex: 1 },
  scroll: { flex: 1 },
  still: { flex: 1, overflow: 'hidden', paddingTop: t.space[16] },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[16] },
  column: { alignSelf: 'center', gap: t.space[24], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  preview: { gap: t.space[12], padding: t.space[24], width: PREVIEW_WIDTH },
  previewScroll: { borderLeftColor: t.color.border.subtle, borderLeftWidth: t.size.border.control, flexGrow: 0 },
}));

export type WizardPreview = Pick<VehicleCardProps, 'title' | 'subtitle' | 'photo' | 'specs'>;

export type WizardFrameProps = {
  step: WizardStep;
  draftId: string;
  /** The furthest step the draft has reached (`wizard.step`), for the desktop rail. */
  reached: number;
  /** The live card of the desktop's right pane. */
  preview: WizardPreview;
  /** Step 4 (DQ-1052): the real VEH-01 render in the right pane instead of the card. */
  previewNode?: ReactNode;
  /** False while the step shows a loading or error state instead of its form. */
  ready?: boolean;
  /** The skeleton: it holds no control and may run past the screen, so it does not scroll (nothing to reach by keyboard). */
  still?: boolean;
  children: ReactNode;
  /** `brand` only for "Veröffentlichen" (ADR-431 a). */
  cta?: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'brand' };
  secondary?: StickyCTASecondary;
  dirty: boolean;
  onDiscard?: () => void;
  /**
   * DQ-254: a state in which no step can start, as a full garage or a draft that is gone. It keeps × and the title, and drops the
   * step's progress, the desktop rail and the preview, which would promise a flow that is not there.
   */
  bare?: boolean;
};

/**
 * FS-5 frame of every wizard step: close (×) left and `headline` "Fahrzeug hinzufügen"; under it `caption` "Schritt 2 von 4 ·
 * Technik" and the 4-segment progress; the form in one column; the sticky bar with "Entwurf speichern" and the primary
 * action above the keyboard. Desktop web adds the steps rail and the live vehicle card (2-pane, §12).
 */
export function WizardFrame({
  step,
  draftId,
  reached,
  preview,
  previewNode,
  ready = true,
  still = false,
  children,
  cta,
  secondary,
  dirty,
  onDiscard,
  bare = false,
}: WizardFrameProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const close = useCloseModal();
  const { kind, gutter, width } = useBreakpoint();
  const desktop = kind === 'desktop' && !bare;
  const number = stepNumber(step);
  const stepLabel = t(`wizard.steps.${step}`);
  const captionText = t('wizard.caption', { step: number, total: WIZARD_STEPS.length, name: stepLabel });
  // The bar's button row lines up with the form column (its view is exempt from the spacing audit as a safe-area view).
  const middle = desktop ? width - RAIL_WIDTH - PREVIEW_WIDTH : width;
  const side = (middle - Math.min(FORM_MAX_WIDTH, middle - 2 * gutter)) / 2;
  const barPadding = desktop ? { paddingLeft: RAIL_WIDTH + side, paddingRight: PREVIEW_WIDTH + side } : { paddingHorizontal: side };

  const caption = (
    <View style={[styles.caption, desktop ? null : { paddingHorizontal: gutter }]} testID="GAR-03.progress">
      <Text variant="caption" color="text.secondary" testID="GAR-03.caption">
        {captionText}
      </Text>
      <Progress variant="wizard" step={number} total={WIZARD_STEPS.length} label={captionText} />
    </View>
  );

  const form = still ? (
    <View style={[styles.still, { paddingHorizontal: gutter }]}>
      <View style={styles.column}>
        {desktop ? caption : null}
        {children}
      </View>
    </View>
  ) : (
    <KeyboardAwareScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={KEYBOARD_OFFSET}
      testID={`GAR-03.${step}.scroll`}
    >
      <View style={styles.column}>
        {desktop ? caption : null}
        {children}
      </View>
    </KeyboardAwareScrollView>
  );

  return (
    <Screen edges={EDGES} testID="GAR-03.root">
      <Header backIcon="close" onBack={close} title={t('wizard.title')} testID="GAR-03.header" />
      {/* Bare: the desktop keeps the hairline under the header, which parts the bar from the pane; a phone has nothing there. */}
      {kind === 'desktop' ? <Hairline /> : bare ? null : caption}
      {online ? null : <OfflineBanner label={t('offline.wizard')} testID="GAR-03.offline" />}
      {desktop ? (
        <View style={styles.desktop}>
          <View role="navigation" aria-label={t('wizard.stepsLabel')} style={styles.rail} testID="GAR-03.rail">
            {WIZARD_STEPS.map((entry) => {
              const index = stepNumber(entry);
              const current = entry === step;
              const open = draftId !== 'new' && index <= Math.max(reached, number) && !current;
              return (
                <PressableScale
                  key={entry}
                  role="link"
                  aria-current={current ? 'step' : undefined}
                  disabled={!open}
                  feedback={false}
                  onPress={() => router.replace(wizardPath(draftId, entry))}
                  contentStyle={[styles.railItem, current ? styles.railCurrent : null]}
                  testID={`GAR-03.rail.${entry}`}
                >
                  {/* The number repeats the order of the list; the name is the step's own text (WCAG 2.5.3). */}
                  <View aria-hidden style={[styles.railIndex, index < number ? styles.railIndexDone : null]}>
                    {index < number ? (
                      <Icon name="check" size={16} color="text.inverse" />
                    ) : (
                      <Text variant="labelBadge" numeric color={current ? 'text.primary' : 'text.secondary'}>
                        {String(index)}
                      </Text>
                    )}
                  </View>
                  {/* ADR-426 f: a step is a link, so its name is the action role, as in the app's sidebar (bodyStrong). */}
                  <Text variant="bodyStrong" color={current ? 'text.primary' : open ? 'text.secondary' : 'text.tertiary'} style={styles.railLabel}>
                    {t(`wizard.steps.${entry}`)}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <View style={styles.body}>{form}</View>
          <ScrollView style={styles.previewScroll} contentContainerStyle={styles.preview} testID="GAR-03.preview">
            <Text variant={SECTION_HEADER_ROLE} color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)} hyphenate={false} testID="GAR-03.preview.title">
              {t('wizard.preview')}
            </Text>
            {previewNode ?? <VehicleCard {...preview} testID="GAR-03.previewCard" />}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.body}>{form}</View>
      )}
      {ready && cta ? (
        <StickyCTABar
          label={cta.label}
          variant={cta.variant}
          onPress={cta.onPress}
          loading={cta.loading}
          disabled={cta.disabled}
          secondary={secondary}
          style={barPadding}
          testID={`GAR-03.${step}.cta`}
        />
      ) : null}
      <DiscardGuardDialog dirty={dirty} onDiscard={onDiscard} testID="GAR-03.discard" />
    </Screen>
  );
}
