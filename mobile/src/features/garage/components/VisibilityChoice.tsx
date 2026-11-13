import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Visibility } from '@/api/queries/garage';
import { createStyles, size, space } from '@/theme';
import { Hairline, Radio, Text } from '@/ui';

import { VISIBILITIES } from '../model';

/** The description lines up with the radio's label: the 22 box and the 12 before the label (SelectionControl). */
const TEXT_INSET = size.checkbox + space[12];

const useStyles = createStyles((t) => ({
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  row: { gap: t.space[2], paddingBottom: t.space[12], paddingHorizontal: t.space[12], paddingTop: t.space[4] },
  bodyRow: { flexDirection: 'row' },
  body: { flex: 1 },
}));

export type VisibilityChoiceProps = {
  value: Visibility;
  onChange: (next: Visibility) => void;
  disabled?: boolean;
  /** Under a restriction only "Privat" stays open (ADR-146 b). */
  onlyPrivate?: boolean;
  testID: string;
};

/**
 * §3.2 visibility: Öffentlich (search, feed, profile, QR) · Nicht gelistet (link and QR only) · Privat (owner only; a scan
 * reads "Dieses Fahrzeug ist privat"). Each option is a radio with its label, the consequence in one line under it.
 */
export function VisibilityChoice({ value, onChange, disabled = false, onlyPrivate = false, testID }: VisibilityChoiceProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  return (
    <View role="radiogroup" aria-label={t('visibility.label')} style={styles.group} testID={testID}>
      {VISIBILITIES.map((option, index) => {
        const off = disabled || (onlyPrivate && option !== 'private' && option !== value);
        return (
          <View key={option}>
            <View style={styles.row}>
              <Radio
                checked={value === option}
                onChange={() => onChange(option)}
                label={t(`visibility.options.${option}.title`)}
                showLabel
                disabled={off}
                testID={`${testID}.${option}`}
              />
              <View style={styles.bodyRow}>
                {/* A spacer and not a padding: the inset is off the spacing scale by design. */}
                <View style={{ width: TEXT_INSET }} />
                <Text variant="callout" color={off ? 'text.disabled' : 'text.secondary'} style={styles.body}>
                  {t(`visibility.options.${option}.body`)}
                </Text>
              </View>
            </View>
            {index < VISIBILITIES.length - 1 ? <Hairline /> : null}
          </View>
        );
      })}
    </View>
  );
}
