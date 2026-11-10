import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { RowBody } from './rowParts';
import { Text } from './Text';

const useStyles = createStyles((t) => ({
  group: { gap: t.space[8] },
  // In line with the text of the rows below, which sit 16 inside the card.
  title: { paddingHorizontal: t.space[16] },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  centred: { alignItems: 'center', justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  centredText: { textAlign: 'center' },
}));

export type RowGroupProps = {
  /** "App", "Rechtliches": sentence case, never caps (§4). */
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * FS-12 grouped inset list (settings, PROF-01, MSG-03): bg.surface, radius 12, rows of 56 with hairlines, monochrome icons. Rows inside pass
 * `inset={space[16]}` and `divider` on all but the last.
 */
export function RowGroup({ title, children, style, testID }: RowGroupProps) {
  const styles = useStyles();
  return (
    <View style={[styles.group, style]} testID={testID}>
      {title ? (
        <Text variant="labelS" color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)} style={styles.title}>
          {title}
        </Text>
      ) : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export type CentredRowProps = {
  label: string;
  onPress: () => void;
  /** accent.fg, for "Abmelden". */
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
};

/** FS-12: the centred row at the end of the settings, alone in its group. */
export function CentredRow({ label, onPress, destructive = false, disabled = false, testID }: CentredRowProps) {
  const styles = useStyles();
  return (
    <RowBody onPress={onPress} role="button" disabled={disabled} label={label} style={styles.centred} testID={testID}>
      <Text
        variant="body"
        color={disabled ? 'text.disabled' : destructive ? 'accent.fg' : 'text.primary'}
        selectable={false}
        style={styles.centredText}
      >
        {label}
      </Text>
    </RowBody>
  );
}
