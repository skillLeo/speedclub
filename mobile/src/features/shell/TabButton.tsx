import type { TabTriggerSlotProps } from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, useTheme } from '@/theme';
import { Icon, PressableScale, Text, UnreadBadge, unreadCountText, type IconName } from '@/ui';
import type { PressableVisualState } from '@/ui/PressableScale';
import { typeStyle } from '@/ui/Text';

export type TabButtonVariant = 'bar' | 'rail' | 'sidebar';

/** At a 72 cell (360 wide) the bar's labels fit up to this scale with about 12 between them; at 1.3 only 4.6 are left (ADR-127). */
export const NARROW_CELL_CAP = 1.15;

/**
 * The DOM audit's counted exemption for a bar label held at that cap (ADR-145, `tab-label`): its type pair is the `tab` token's
 * at min(scale, 1.15), not the scaled one.
 */
const CAPPED_TAB_LABEL = { qaExempt: 'tab-label' } as const;

/** `style` is dropped on purpose: TabTrigger's default row layout must not reach this component. */
export type TabButtonProps = Omit<TabTriggerSlotProps, 'ref' | 'style' | 'children'> & {
  variant: TabButtonVariant;
  icon: IconName;
  label: string;
  /** Count pill. */
  count?: number;
  /** Dot, spoken with this label. */
  dotLabel?: string;
  /** Font-scale cap below the `tab` token's, where the width needs it. */
  labelCap?: number;
  /**
   * Bar only: the first or last cell. Its label borrows no air, because on that side there is no neighbour but the screen edge.
   * A label box 12 past the last cell made every phone page 12 wider than the window (M2.8 round 2, DQ-405).
   */
  edge?: boolean;
  testID: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  style?: unknown;
};

const useStyles = createStyles((t) => {
  const iconBox = { alignItems: 'center', height: t.size.iconButton / 2 + t.space[2], justifyContent: 'center', width: t.size.iconButton / 2 + t.space[2] } as const;
  return {
    bar: { flex: 1, height: t.size.tabBar },
    // The radius shapes the inset focus ring (ADR-118): the bar has no room for an outer one.
    barContent: { alignItems: 'center', borderRadius: t.radius.sm, flexGrow: 1, gap: t.space[4], paddingTop: t.space[12] },
    rail: { height: t.size.tabBar, width: '100%' },
    railContent: {
      alignItems: 'center',
      borderRadius: t.radius.sm,
      flexGrow: 1,
      gap: t.space[4],
      paddingTop: t.space[12],
    },
    sidebar: { minHeight: t.size.row.single, width: '100%' },
    sidebarContent: {
      alignItems: 'center',
      borderRadius: t.radius.sm,
      flexDirection: 'row',
      flexGrow: 1,
      gap: t.space[12],
      paddingHorizontal: t.space[12],
      paddingVertical: t.space[8],
    },
    hovered: { backgroundColor: t.color.state.hover },
    pressed: { backgroundColor: t.color.state.pressed },
    iconBox,
    // "Nachrichten" is wider than a tab at 320 pt. Its neighbours are short, so it may use their air: wrapping would
    // break the bar, and a clipped label is the one thing §9 rules out. Equal cells stay equal.
    barLabelBox: { alignSelf: 'stretch', marginHorizontal: -t.space[12] },
    barLabelBoxEdge: { marginHorizontal: 0 },
    barLabel: { textAlign: 'center' },
    sidebarLabel: { flex: 1 },
    // Over the icon's top right: 12 past its left edge, which is half a cell, and 4 above its top at 12. It follows the
    // label in the DOM, so the visible text reads "Nachrichten 3", as the accessible name does (WCAG 2.5.3).
    pill: { left: '50%', position: 'absolute', top: t.space[8] },
    // At the end of the row: on the icon, "99+" would run into the label, which starts 12 after it.
    sidebarPill: { alignSelf: 'center', flexShrink: 0 },
    dot: { position: 'absolute', right: 0, top: 0 },
  };
});

/**
 * The child of a name-only `TabTrigger asChild`, so it gets `href`, `isFocused` and the handlers from the trigger. On
 * web it renders a real link: ctrl-click opens a new browser tab.
 */
export function TabButton({
  variant,
  icon,
  label,
  count,
  dotLabel,
  labelCap,
  edge = false,
  isFocused,
  testID,
  style: _ignored,
  ...trigger
}: TabButtonProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const focused = Boolean(isFocused);
  // Native caps through the prop; web scales the type itself, in the QA font scale.
  const capped = labelCap === undefined ? undefined : typeStyle(variant === 'sidebar' ? 'label' : 'tab', isWeb ? Math.min(theme.fontScale, labelCap) : 1);
  const color = focused ? 'text.primary' : 'text.secondary';
  // The figure on the pill, so a voice-control user can say what they see.
  const hasCount = Boolean(count && count > 0);
  const unread = count && hasCount ? t('a11y.unreadCount', { count: unreadCountText(count) }) : dotLabel;
  // A space with nothing to show: label and pill are separate boxes, and without it their text reads "Nachrichten3".
  const labelText = hasCount ? `${label} ` : label;

  const contentStyle = ({ hovered, pressed }: PressableVisualState) => [
    variant === 'bar' ? styles.barContent : variant === 'rail' ? styles.railContent : styles.sidebarContent,
    variant !== 'bar' && hovered ? styles.hovered : null,
    variant !== 'bar' && pressed ? styles.pressed : null,
  ];

  return (
    <PressableScale
      {...trigger}
      role="tab"
      aria-selected={focused}
      aria-label={unread ? `${label}, ${unread}` : label}
      feedback={false}
      ring={variant === 'sidebar' ? 'default' : 'inset'}
      testID={testID}
      style={variant === 'bar' ? styles.bar : variant === 'rail' ? styles.rail : styles.sidebar}
      contentStyle={contentStyle}
    >
      <View style={styles.iconBox}>
        <Icon name={icon} size={24} weight={focused ? 'fill' : 'regular'} color={color} />
        {dotLabel ? <UnreadBadge style={styles.dot} testID={`${testID}.dot`} /> : null}
      </View>
      {variant === 'sidebar' ? (
        <Text
          variant="label"
          color={color}
          selectable={false}
          {...(labelCap === undefined ? {} : { maxFontSizeMultiplier: labelCap })}
          style={[styles.sidebarLabel, capped]}
        >
          {labelText}
        </Text>
      ) : (
        <View style={[styles.barLabelBox, edge ? styles.barLabelBoxEdge : null]} testID={`${testID}.labelBox`}>
          <Text
            variant="tab"
            color={color}
            numberOfLines={1}
            selectable={false}
            dataSet={labelCap === NARROW_CELL_CAP ? CAPPED_TAB_LABEL : undefined}
            {...(labelCap === undefined ? {} : { maxFontSizeMultiplier: labelCap })}
            style={[styles.barLabel, capped]}
          >
            {labelText}
          </Text>
        </View>
      )}
      {count && count > 0 ? (
        <UnreadBadge count={count} decorative style={variant === 'sidebar' ? styles.sidebarPill : styles.pill} testID={`${testID}.badge`} />
      ) : null}
    </PressableScale>
  );
}
