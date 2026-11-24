import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';

import { DexRulesSheet, EXPLAINER_STEPS } from './DexExplainer';

const useStyles = createStyles((t) => ({
  // The screen's state slot already leaves 16 under the large title.
  root: { alignSelf: 'stretch', paddingBottom: t.space[24], paddingTop: t.space[8] },
  steps: { gap: t.space[8], marginTop: t.space[12] },
  step: { alignItems: 'baseline', flexDirection: 'row', gap: t.space[12] },
  stepText: { flex: 1 },
  note: { marginTop: t.space[12] },
  action: { alignSelf: 'flex-start', marginTop: t.space[24] },
  how: { marginTop: t.space[8] },
  preview: { marginTop: t.space[24] },
}));

export type DexEmptyIntroProps = {
  /** `DEX-01.empty` or `DEX-01.guest`. */
  testID: string;
  title: string;
  /** A line under the steps where they alone do not say it (the member web: scanning needs the phone). */
  note?: string;
  action: { label: string; onPress: () => void; disabled?: boolean };
  /** The badged sample card and a "???" slot (09 §5 "never empty"). */
  preview: ReactNode;
  routeId: string;
};

/**
 * R4DQ-12: the empty Dex (and a guest's) explains itself once. The title, the three steps of the explainer, the one action directly
 * under them (in the first viewport at 390 × 844), "So funktioniert's" as a link to the rules sheet, then the badged sample. The
 * explainer card of R4-3.1 draws only once the member has cards, so nothing is said twice.
 */
export function DexEmptyIntro({ testID, title, note, action, preview, routeId }: DexEmptyIntroProps) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <View style={styles.root} testID={testID}>
      <Text variant="title2" role="heading" aria-level={2} testID={`${testID}.title`}>
        {title}
      </Text>
      <View role="list" aria-label={t('explainer.stepsLabel')} style={styles.steps} testID={`${testID}.steps`}>
        {EXPLAINER_STEPS.map((step, index) => (
          <View key={step} role="listitem" style={styles.step} testID={`${testID}.step.${step}`}>
            <Text variant="body" color="text.secondary" numeric aria-hidden>
              {String(index + 1)}
            </Text>
            <Text variant="body" style={styles.stepText}>
              {t(`explainer.steps.${step}`)}
            </Text>
          </View>
        ))}
      </View>
      {note ? (
        <Text variant="body" color="text.secondary" style={styles.note} testID={`${testID}.note`}>
          {note}
        </Text>
      ) : null}
      <Button label={action.label} variant="primary" size="l" disabled={action.disabled} onPress={action.onPress} style={styles.action} testID={`${testID}.action`} />
      <View style={styles.how}>
        <Button
          label={t('explainer.how')}
          variant="tertiary"
          size="s"
          icon="info"
          flush="start"
          onPress={() => setSheetOpen(true)}
          testID={`${testID}.how`}
        />
      </View>
      <View style={styles.preview} testID={`${testID}.preview`}>
        {preview}
      </View>
      <DexRulesSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} testID={`${routeId}.rulesSheet`} />
    </View>
  );
}
