import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint, useTheme, type space, type SpaceToken } from '@/theme';

import { Hairline } from './Hairline';
import { PressableScale, type PressableVisualState } from './PressableScale';

/** Side padding of a row. Defaults to the screen gutter; 16 inside a card, 0 inside a padded section. */
export type RowInset = (typeof space)[SpaceToken];

/** Above this font scale a row's trailing element or a 4-column layout no longer fits beside its text. */
const STACK_FONT_SCALE = 1.2;

/**
 * From this font scale a line that still wrapped well at the stacking threshold has to change its form: a meta line takes its own
 * line, a member's name a second line, a teaser hyphenates, the Home rail joins the page (DQ-129, DQ-199, DQ-203, DQ-230).
 */
export const LARGE_FONT_SCALE = 1.5;

const useStyles = createStyles((t) => ({
  divider: { bottom: 0, flexDirection: 'row', left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  line: { flex: 1 },
  hover: { backgroundColor: t.color.state.hover },
  pressed: { backgroundColor: t.color.state.pressed },
  // ADR-118: §5 mirrored into the row, 2 ring + 2 offset. A full-width row has no room outside before the screen edge,
  // and a list group clips its rows. The radius keeps the ring's corners clear of the group's radius 12.
  ring: {
    borderRadius: t.radius.sm,
    outlineColor: t.color.focus.ring,
    outlineOffset: -(t.size.border.focusRing + t.size.border.focusOffset),
    outlineStyle: 'solid',
    outlineWidth: t.size.border.focusRing,
  },
}));

export function useRowInset(inset: RowInset | undefined): number {
  const { gutter } = useBreakpoint();
  return inset ?? gutter;
}

export function useStacksAtFontScale(): boolean {
  return useTheme().fontScale > STACK_FONT_SCALE;
}

/**
 * The hairline of a row, drawn over its bottom edge so a 56 row stays 56. `lead` is the distance to the text start.
 * It is a spacer and not a margin: margins off the spacing scale are audit findings, and 68 is not on the scale.
 */
export function RowDivider({ inset, lead = 0 }: { inset: number; lead?: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.divider, { paddingLeft: inset, paddingRight: inset }]}>
      {lead > 0 ? <View style={{ width: lead }} /> : null}
      <Hairline style={styles.line} />
    </View>
  );
}

export type RowBodyProps = {
  onPress?: () => void;
  disabled?: boolean;
  role?: 'button' | 'link';
  /** Accessible name of the whole row. */
  label?: string;
  /** The page this row leads to is the one on screen: `aria-current="page"` on web, selected for native screen readers. */
  current?: boolean;
  /** The Pressable box inside the row layout. */
  boxStyle?: StyleProp<ViewStyle>;
  /** The row content. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode | ((state: PressableVisualState) => ReactNode);
};

const IDLE: PressableVisualState = { pressed: false, hovered: false, focused: false };

/**
 * The pressable part of a row. Rows press with a background and no scale: scaling a full-width row would pull its
 * edges off the hairlines. Without `onPress` it is a plain view, so a static row exposes no control. `label` is for
 * native: on web the visible texts are the name, because voice control must find what it sees (WCAG 2.5.3).
 */
export function RowBody({ onPress, disabled = false, role = 'link', label, current = false, boxStyle, style, testID, children }: RowBodyProps) {
  const styles = useStyles();
  if (!onPress) {
    return (
      <View testID={testID} style={[boxStyle, style]}>
        {typeof children === 'function' ? children(IDLE) : children}
      </View>
    );
  }
  return (
    <PressableScale
      // Draws its own pressed fill from state.pressed: no second tone layer (SM7).
      toneShift={false}
      role={role}
      aria-label={isWeb ? undefined : label}
      {...(current ? (isWeb ? ({ 'aria-current': 'page' } as object) : { 'aria-selected': true }) : {})}
      disabled={disabled}
      feedback={false}
      ring="none"
      onPress={onPress}
      testID={testID}
      style={boxStyle}
      contentStyle={(state) => [style, state.pressed ? styles.pressed : state.hovered ? styles.hover : null, state.focused ? styles.ring : null]}
    >
      {children}
    </PressableScale>
  );
}

/** A zero-width space: a word boundary that shows nothing and takes no width. */
const WORD_BOUNDARY = '\u200B';

/**
 * Web: `text` with an invisible word boundary at its end when more visible text follows in another box. Boxes do not separate
 * the words of their text for the accessibility checks, so "Nissan Silvia S15" over "13:32" reads "S1513:32", which no label
 * can contain and voice control could not match (WCAG 2.5.3). Native gets the text as it is.
 */
export function endsWord(text: string, more: boolean): string {
  // A plain character, not an unselectable span: axe's visible-text check drops a user-select:none span, so the name then
  // misses the boundary again (label-content-name-mismatch on the DISC-02 filter chip, M2.8 final run). Code review nit 11
  // (a copied name carrying U+200B) is accepted for that reason.
  return isWeb && more ? `${text}${WORD_BOUNDARY}` : text;
}

/** Joins the visible strings of a card or row into its accessible name. */
export function joinLabel(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(', ');
}
