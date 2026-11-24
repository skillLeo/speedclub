import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { RowBody } from './rowParts';
import { Text } from './Text';

/**
 * ADR-426 e (amended after design QA round 3, DQ-928): one role for every grouped-list and form section header ("Sicherheit",
 * "Dieses Fahrzeug"): `callout.strong` 14/20 **600** in `text.secondary`, sentence case, one weight step above the `callout`
 * 500 field labels, so a header never reads as one more label. RowGroup, the garage FormGroup, the wizard's preview header and
 * every skeleton line that stands for such a header use it, so the lists never show one pattern in two sizes again (DQ-906).
 */
export const SECTION_HEADER_ROLE = 'calloutStrong' as const;

const useStyles = createStyles((t) => ({
  // ADR-426 e: space.8 below the header; the lists that stack groups set space.32 between them.
  group: { gap: t.space[8] },
  // In line with the text of the rows below, which sit 16 inside the card.
  title: { paddingHorizontal: t.space[16] },
  // The header and its caption as one block, 2 apart; the group's 8 follows under the caption.
  heading: { gap: t.space[2], paddingHorizontal: t.space[16] },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  centred: { alignItems: 'center', justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  centredText: { textAlign: 'center' },
}));

export type RowGroupProps = {
  /** "App", "Rechtliches": sentence case, never caps (§4). */
  title?: string;
  /** A caption line under the title, for what the numbers of the group cover ("Letzte 30 Tage", INS-01 DQ-P5-018). */
  caption?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * FS-12 grouped inset list (settings, PROF-01, MSG-03): bg.surface, radius 12, rows of 56 with hairlines, monochrome icons. Rows inside pass
 * `inset={space[16]}` and `divider` on all but the last.
 */
export function RowGroup({ title, caption, children, style, testID }: RowGroupProps) {
  const styles = useStyles();
  return (
    <View style={[styles.group, style]} testID={testID}>
      {title && caption ? (
        <View style={styles.heading}>
          <Text variant={SECTION_HEADER_ROLE} color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)} testID={testID ? `${testID}.title` : undefined}>
            {title}
          </Text>
          <Text variant="caption" color="text.tertiary" testID={testID ? `${testID}.caption` : undefined}>
            {caption}
          </Text>
        </View>
      ) : title ? (
        <Text variant={SECTION_HEADER_ROLE} color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)} style={styles.title} testID={testID ? `${testID}.title` : undefined}>
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
