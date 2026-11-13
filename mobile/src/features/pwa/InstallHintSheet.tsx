import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Icon, Sheet, Text, type IconName } from '@/ui';

import type { InstallVariant } from './installHint';

const ID = 'shell.installHint';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[20], paddingBottom: t.space[24] },
  steps: { gap: t.space[16] },
  step: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  stepText: { flex: 1, minWidth: 0 },
  actions: { gap: t.space[8] },
}));

/** Safari's own controls, in the order the member taps them. */
const IOS_STEPS: readonly { key: string; icon: IconName }[] = [
  { key: 'share', icon: 'export' },
  { key: 'add', icon: 'plus-square' },
  { key: 'confirm', icon: 'check' },
];

export type InstallHintSheetProps = {
  visible: boolean;
  variant: InstallVariant;
  onClose: () => void;
  /** `prompt` only: the browser's own install dialog. */
  onInstall?: () => void;
};

/**
 * The install hint (09 §7.15): what SPEED CLUB is like from the home screen, and how to get it there. iOS names Safari's steps
 * with the real share glyph; a Chromium browser offers its install dialog. One action each, the sheet's own close and drag
 * dismiss it; the Sheet primitive brings the reduced-motion crossfade.
 */
export function InstallHintSheet({ visible, variant, onClose, onInstall }: InstallHintSheetProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('pwa.install.title')} expandable={false} narrow testID={ID}>
      <View style={styles.body}>
        <Text variant="body" color="text.secondary" testID={`${ID}.lead`}>
          {t('pwa.install.lead')}
        </Text>
        {variant === 'ios' ? (
          <View style={styles.steps} role="list" testID={`${ID}.steps`}>
            {IOS_STEPS.map((step) => (
              <View key={step.key} style={styles.step} role="listitem" testID={`${ID}.step.${step.key}`}>
                <Icon name={step.icon} size={24} color="text.primary" />
                <Text variant="body" style={styles.stepText}>
                  {t(`pwa.install.steps.${step.key}`)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          {variant === 'prompt' ? (
            <>
              <Button label={t('pwa.install.install')} size="l" fullWidth onPress={onInstall} testID={`${ID}.install`} />
              <Button label={t('pwa.install.later')} variant="tertiary" size="l" fullWidth onPress={onClose} testID={`${ID}.dismiss`} />
            </>
          ) : (
            <Button label={t('pwa.install.gotIt')} variant="secondary" size="l" fullWidth onPress={onClose} testID={`${ID}.dismiss`} />
          )}
        </View>
      </View>
    </Sheet>
  );
}
