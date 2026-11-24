import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Hairline } from '@/ui/Hairline';
import { IconButton } from '@/ui/IconButton';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';

import { countDexVisit, dismissDexExplainer, explainerExpanded, useDexExplainerStore } from '../explainer';

/** The three steps of the card, in order. */
export const EXPLAINER_STEPS = ['scan', 'collect', 'sets'] as const;
/** The rules of the sheet, in order. */
export const EXPLAINER_RULES = ['counts', 'delay', 'samples', 'privacy', 'sets'] as const;

const useStyles = createStyles((t) => ({
  // A tile of the page (radius 12, surface), no box inside it; the steps are a list with numerals on the start edge.
  card: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[12],
    paddingBottom: t.space[8],
    paddingLeft: t.space[16],
    paddingTop: t.space[16],
  },
  top: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8] },
  title: { flex: 1, paddingTop: t.space[8] },
  steps: { gap: t.space[8], paddingRight: t.space[16] },
  step: { alignItems: 'baseline', flexDirection: 'row', gap: t.space[12] },
  stepText: { flex: 1 },
  compact: { alignItems: 'flex-start' },
  sheetBody: { gap: t.space[16], paddingBottom: t.space[8] },
  rule: { gap: t.space[4] },
}));

/** "So funktioniert's": the rules of the Dex in plain words (R4-3.1). */
export function DexRulesSheet({
  visible,
  onClose,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  testID: string;
}) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('explainer.sheet.title')}
      footer={
        <Button
          label={t('explainer.sheet.close')}
          variant="secondary"
          fullWidth
          onPress={onClose}
          testID={`${testID}.close`}
        />
      }
      testID={testID}
    >
      <View style={styles.sheetBody} role="list">
        {EXPLAINER_RULES.map((rule, index) => (
          <View key={rule} role="listitem" style={styles.rule} testID={`${testID}.rule.${rule}`}>
            {index > 0 ? <Hairline /> : null}
            <Text variant="headline" role="heading" aria-level={3}>
              {t(`explainer.sheet.${rule}.title`)}
            </Text>
            <Text variant="body" color="text.secondary">
              {t(`explainer.sheet.${rule}.body`)}
            </Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

/**
 * DEX-01's explainer (R4-3.1, docs/11_CLIENT_ROUND_4.md): "Dein STREET DEX: Autos sammeln, die du in echt siehst" with the three
 * steps and "So funktioniert's", expanded on the first visits on this device until hidden (features/dex/explainer.ts), then the
 * compact link alone. Nothing draws until the device's state is read, so the card never flips after its first frame.
 */
export function DexExplainer({ routeId, style }: { routeId: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const state = useDexExplainerStore();
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void countDexVisit();
  }, []);

  if (!state.hydrated) return null;
  const sheet = (
    <DexRulesSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} testID={`${routeId}.rulesSheet`} />
  );
  const how = (
    <Button
      label={t('explainer.how')}
      variant="tertiary"
      size="s"
      icon="info"
      flush="start"
      onPress={() => setSheetOpen(true)}
      testID={`${routeId}.explainer.how`}
    />
  );

  if (!explainerExpanded(state)) {
    return (
      <View style={[styles.compact, style]} testID={`${routeId}.explainer.compact`}>
        {how}
        {sheet}
      </View>
    );
  }

  return (
    <View style={style}>
      <View style={styles.card} testID={`${routeId}.explainer`}>
        <View style={styles.top}>
          <Text
            variant="headline"
            role="heading"
            aria-level={2}
            style={styles.title}
            testID={`${routeId}.explainer.title`}
          >
            {t('explainer.title')}
          </Text>
          <IconButton
            icon="x"
            label={t('explainer.hide')}
            onPress={dismissDexExplainer}
            testID={`${routeId}.explainer.hide`}
          />
        </View>
        <View role="list" aria-label={t('explainer.stepsLabel')} style={styles.steps}>
          {EXPLAINER_STEPS.map((step, index) => (
            <View key={step} role="listitem" style={styles.step} testID={`${routeId}.explainer.step.${step}`}>
              <Text variant="callout" color="text.secondary" numeric aria-hidden>
                {String(index + 1)}
              </Text>
              <Text variant="callout" style={styles.stepText}>
                {t(`explainer.steps.${step}`)}
              </Text>
            </View>
          ))}
        </View>
        {how}
      </View>
      {sheet}
    </View>
  );
}
