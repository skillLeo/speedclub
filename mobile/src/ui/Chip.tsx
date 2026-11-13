import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, size, type ColorToken } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { PressableScale, PressToneLayer, usePressTone, type PressableVisualState } from './PressableScale';
import { useForcedVisualState } from './qaVisualState';
import { endsWord } from './rowParts';
import { Text } from './Text';

export type ChipProps = {
  label: string;
  onPress?: () => void;
  /** Set for a toggle or choice: role checkbox (or `radio`) with `aria-checked`. Omit for a plain action. */
  selected?: boolean;
  selectionRole?: 'checkbox' | 'radio';
  /** Adds the 16 × with a 44 hit area. */
  onRemove?: () => void;
  /** Name of the × for screen readers; defaults to "{label}: Entfernen" with the word from namespace common. */
  removeLabel?: string;
  count?: number;
  /**
   * The chip's accessible name when its visible text alone says too little, e.g. "Filter, 2 aktiv" or "BMW, 12 Builds". It must
   * start with the visible label (WCAG 2.5.3, label in name). Without it, native reads "{label} {count}" and web reads the text.
   */
  accessibilityLabel?: string;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const REMOVE_VISUAL_WIDTH = size.icon.s + size.buttonPaddingX.s;
/** Inside the shell's border, so the removable chip stays 36 like the plain one. */
const REMOVABLE_INNER_HEIGHT = size.chip - size.border.control * 2;

const useStyles = createStyles((t) => ({
  // DQ-187: never wider than its row. A long term ends in an ellipsis on one line; its name keeps the whole term.
  hug: { alignSelf: 'flex-start', maxWidth: '100%' },
  chip: {
    alignItems: 'center',
    borderColor: t.color.border.default,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
    flexDirection: 'row',
    gap: t.space[8],
    justifyContent: 'center',
    minHeight: t.size.chip,
    maxWidth: '100%',
    minWidth: t.size.touchMin,
    paddingHorizontal: t.space[12],
  },
  selected: { backgroundColor: t.color.bg.inverse, borderColor: t.color.bg.inverse },
  disabled: { borderColor: t.color.border.subtle },
  hover: { backgroundColor: t.color.state.hover },
  removableShell: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 0 },
  body: { flexShrink: 1, minWidth: 0 },
  bodyVisual: {
    alignItems: 'center',
    flexDirection: 'row',
    flexGrow: 0,
    gap: t.space[8],
    minHeight: REMOVABLE_INNER_HEIGHT,
    paddingLeft: t.space[12],
  },
  remove: { alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center', paddingRight: t.space[12] },
  removeVisual: { alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  count: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    justifyContent: 'center',
    minHeight: t.size.unreadPill,
    minWidth: t.size.unreadPill,
    paddingHorizontal: t.space[4],
  },
  countSelected: { backgroundColor: t.color.bg.canvas },
  label: { flexShrink: 1, minWidth: 0 },
}));

/** §8 chip: 36 high, full radius, 1 border.default, selected = inverse. */
export function Chip({
  label,
  onPress,
  selected,
  selectionRole = 'checkbox',
  onRemove,
  removeLabel,
  count,
  accessibilityLabel,
  icon,
  disabled = false,
  style,
  testID,
}: ChipProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const isSelected = selected === true;
  const color: ColorToken = disabled ? 'text.disabled' : isSelected ? 'text.inverse' : 'text.primary';
  const toggle = selected !== undefined;
  const a11y = toggle
    ? ({ role: selectionRole, 'aria-checked': isSelected } as const)
    : ({ role: 'button' } as const);

  // SM7 tone (ADR-421 c): state.pressed, or state.pressedInverse on the inverted fill of a selected chip; it fades on effect.fast.
  const tone = isSelected ? 'inverse' : 'default';

  const press = () => {
    if (toggle) haptics.selection();
    onPress?.();
  };

  // Hover only; the pressed tone is the press base's layer (or the shell's) above it.
  const visualState = (state: PressableVisualState): StyleProp<ViewStyle> => (isSelected || !state.hovered ? null : styles.hover);

  const content = (
    <>
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <Text variant="callout" color={color} selectable={false} hyphenate={false} numberOfLines={1} style={styles.label}>
        {/* "Filter" and its count are separate boxes: their visible text must read "Filter 3", not "Filter3" (WCAG 2.5.3). */}
        {endsWord(label, count !== undefined)}
      </Text>
      {count !== undefined ? (
        <View style={[styles.count, isSelected ? styles.countSelected : null]}>
          <Text variant="labelBadge" numeric color={isSelected ? 'text.primary' : 'text.secondary'} selectable={false}>
            {count}
          </Text>
        </View>
      ) : null}
    </>
  );

  if (!onRemove) {
    return (
      <PressableScale
        tone={tone}
        {...a11y}
        aria-label={accessibilityLabel ?? (isWeb ? undefined : count === undefined ? label : `${label} ${count}`)}
        disabled={disabled}
        visualHeight={size.chip}
        onPress={press}
        testID={testID}
        style={[styles.hug, style]}
        contentStyle={(state) => [
          styles.chip,
          isSelected ? styles.selected : null,
          disabled ? styles.disabled : null,
          visualState(state),
        ]}
      >
        {content}
      </PressableScale>
    );
  }

  return (
    <RemovableChip
      label={label}
      onPress={onPress ? press : undefined}
      onRemove={onRemove}
      removeLabel={removeLabel ?? `${label}: ${t('actions.remove')}`}
      a11y={a11y}
      accessibilityLabel={accessibilityLabel}
      selected={isSelected}
      tone={tone}
      color={color}
      disabled={disabled}
      style={style}
      testID={testID}
    >
      {content}
    </RemovableChip>
  );
}

type RemovableChipProps = {
  label: string;
  onPress?: () => void;
  onRemove: () => void;
  removeLabel: string;
  a11y: { role: 'checkbox' | 'radio'; 'aria-checked': boolean } | { role: 'button' };
  accessibilityLabel?: string;
  selected: boolean;
  tone: 'default' | 'inverse';
  color: ColorToken;
  disabled: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
};

/**
 * A removable chip is two targets in one pill: the shell draws their tone, so it keeps the pill's rounded ends. Its own
 * component (NH-5), so only these chips own the shell's tone value and its animated style; a plain chip has none.
 */
function RemovableChip({
  label,
  onPress,
  onRemove,
  removeLabel,
  a11y,
  accessibilityLabel,
  selected,
  tone,
  color,
  disabled,
  style,
  testID,
  children,
}: RemovableChipProps) {
  const styles = useStyles();
  const forced = useForcedVisualState();
  const shellTone = usePressTone(Boolean(forced?.pressed) && !disabled);
  const shell = [styles.hug, styles.chip, styles.removableShell, selected ? styles.selected : null, disabled ? styles.disabled : null, style];
  return (
    <View testID={testID} style={shell}>
      {onPress ? (
        <PressableScale
          {...a11y}
          aria-label={accessibilityLabel ?? label}
          disabled={disabled}
          visualHeight={REMOVABLE_INNER_HEIGHT}
          toneShift={false}
          onPressIn={shellTone.pressIn}
          onPressOut={shellTone.pressOut}
          onPress={onPress}
          testID={testID ? `${testID}.body` : undefined}
          style={styles.body}
          contentStyle={styles.bodyVisual}
        >
          {children}
        </PressableScale>
      ) : (
        <View style={styles.bodyVisual}>{children}</View>
      )}
      <PressableScale
        role="button"
        aria-label={removeLabel}
        disabled={disabled}
        visualHeight={REMOVABLE_INNER_HEIGHT}
        visualWidth={REMOVE_VISUAL_WIDTH}
        toneShift={false}
        onPressIn={shellTone.pressIn}
        onPressOut={shellTone.pressOut}
        onPress={onRemove}
        testID={testID ? `${testID}.remove` : undefined}
        style={[styles.remove, { minWidth: REMOVE_VISUAL_WIDTH }]}
        contentStyle={styles.removeVisual}
      >
        <Icon name="x" size={16} color={color} />
      </PressableScale>
      {disabled ? null : (
        <PressToneLayer
          tone={tone}
          animatedStyle={shellTone.style}
          shape={StyleSheet.flatten(shell) ?? undefined}
        />
      )}
    </View>
  );
}
