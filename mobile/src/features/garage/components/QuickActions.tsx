import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { VehicleCardData } from '@/api/queries/profile';
import { createStyles, size } from '@/theme';
import { Button, IconButton, SkeletonBlock } from '@/ui';

export type QuickAction = 'update' | 'mods' | 'photos' | 'qr';

const useStyles = createStyles((t) => ({
  // One row (DQ-1051): the filled "Update posten" first, Mods and Fotos as secondary buttons beside it. At large text the row wraps
  // between buttons, never inside a label. The QR code is the row's last control, a tonal glyph button: a control floating on the
  // card's photo overlapped the card's link (DOM audit `overlap` High in m4.10-shots / m4.9-shots-r3).
  row: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space[16], rowGap: t.space[8] },
  primary: { flexGrow: 1 },
}));

export type QuickActionsProps = {
  card: VehicleCardData;
  onAction: (action: QuickAction, card: VehicleCardData) => void;
  /** Restricted (DQ-1067 a): the editing actions take no taps; the banner above says why. */
  disabled?: boolean;
  /**
   * DQ-1120: whether "Update posten" is the screen's one filled control. The desktop grid shows a row per car; only the main car's
   * is filled, the others are secondary.
   */
  primary?: boolean;
  /** `GAR-01.card.<id>`. */
  testID: string;
};

/**
 * GAR-01 quick actions for the focused car (09 §7.6, DQ-1051): "Update posten" as the screen's one filled control (S), Mods and
 * Fotos as secondary S. No icon-on-top tiles (09 §14.3).
 */
export const QuickActions = memo(function QuickActions({ card, onAction, disabled = false, primary = true, testID }: QuickActionsProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const vehicle = card.full_title;
  return (
    <View role="toolbar" aria-label={t('garage.actionsFor', { vehicle })} style={styles.row} testID={`${testID}.actions`}>
      <Button
        label={t('garage.quick.update')}
        accessibilityLabel={t('garage.quick.updateLabel', { vehicle })}
        variant={primary ? 'primary' : 'secondary'}
        size="s"
        disabled={disabled}
        onPress={() => onAction('update', card)}
        style={styles.primary}
        testID={`${testID}.update`}
      />
      {(['mods', 'photos'] as const).map((action) => (
        <Button
          key={action}
          label={t(`garage.quick.${action}`)}
          accessibilityLabel={t(`garage.quick.${action}Label`, { vehicle })}
          variant="secondary"
          size="s"
          disabled={disabled}
          onPress={() => onAction(action, card)}
          testID={`${testID}.${action}`}
        />
      ))}
      {card.qr ? (
        // QR stays usable under a restriction (DQ-1067 a): it only shows the code.
        <IconButton icon="qr-code" variant="tonal" label={t('garage.quick.qrLabel', { vehicle })} onPress={() => onAction('qr', card)} testID={`${testID}.qr`} />
      ) : null}
    </View>
  );
});

/** The row's skeleton: three S buttons at their real height. */
export function QuickActionsSkeleton({ testID }: { testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.primary}>
        <SkeletonBlock height={size.button.s} corner="sm" />
      </View>
      <SkeletonBlock width={size.avatar.lg} height={size.button.s} corner="sm" />
      <SkeletonBlock width={size.avatar.lg} height={size.button.s} corner="sm" />
    </View>
  );
}
