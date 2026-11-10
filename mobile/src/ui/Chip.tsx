import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, size, type ColorToken } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { PressableScale, type PressableVisualState } from './PressableScale';
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
  pressed: { backgroundColor: t.color.state.pressed },
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

  const press = () => {
    if (toggle) haptics.selection();
    onPress?.();
  };

  const visualState = (state: PressableVisualState): StyleProp<ViewStyle> =>
    isSelected ? null : state.pressed ? styles.pressed : state.hovered ? styles.hover : null;

  const content = (
    <>
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <Text variant="labelS" color={color} selectable={false} hyphenate={false} numberOfLines={1} style={styles.label}>
        {/* "Filter" and its count are separate boxes: their visible text must read "Filter 3", not "Filter3" (WCAG 2.5.3). */}
        {endsWord(label, count !== undefined)}
      </Text>
      {count !== undefined ? (
        <View style={[styles.count, isSelected ? styles.countSelected : null]}>
          <Text variant="badge" color={isSelected ? 'text.primary' : 'text.secondary'} selectable={false}>
            {count}
          </Text>
        </View>
      ) : null}
    </>
  );

  if (!onRemove) {
    return (
      <PressableScale
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
    <View
      testID={testID}
      style={[
        styles.hug,
        styles.chip,
        styles.removableShell,
        isSelected ? styles.selected : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {onPress ? (
        <PressableScale
          {...a11y}
          aria-label={accessibilityLabel ?? label}
          disabled={disabled}
          visualHeight={REMOVABLE_INNER_HEIGHT}
          onPress={press}
          testID={testID ? `${testID}.body` : undefined}
          style={styles.body}
          contentStyle={styles.bodyVisual}
        >
          {content}
        </PressableScale>
      ) : (
        <View style={styles.bodyVisual}>{content}</View>
      )}
      <PressableScale
        role="button"
        aria-label={removeLabel ?? `${label}: ${t('actions.remove')}`}
        disabled={disabled}
        visualHeight={REMOVABLE_INNER_HEIGHT}
        visualWidth={REMOVE_VISUAL_WIDTH}
        onPress={onRemove}
        testID={testID ? `${testID}.remove` : undefined}
        style={[styles.remove, { minWidth: REMOVE_VISUAL_WIDTH }]}
        contentStyle={styles.removeVisual}
      >
        <Icon name="x" size={16} color={color} />
      </PressableScale>
    </View>
  );
}
