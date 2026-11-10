import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space, useTheme } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { Photo, type PhotoFields } from './Photo';
import { joinLabel, RowBody, RowDivider, useRowInset, type RowInset } from './rowParts';
import { Text } from './Text';

export type ListRowProps = {
  title: string;
  /** Makes it the 72 row. */
  subtitle?: string;
  icon?: IconName;
  /** A 56 thumb instead of the icon: also the 72 row. */
  thumb?: PhotoFields;
  /** Trailing value, for example the current language. */
  value?: string;
  /**
   * DQ-103, DQ-152: the row measures itself, and `value` takes its own line under the title and subtitle once one of them
   * would break inside a word beside it, or the value would not fit its half of the row, and always from font scale 1.5.
   * Off by default, where the value always trails.
   */
  adaptiveValue?: boolean;
  /**
   * False for names, which must never split inside the word (a make, "@paul.roadster"): title and subtitle then break
   * only at their spaces (§4, DQ-152, DQ-186). On by default, for German copy.
   */
  hyphenate?: boolean;
  /** A switch or button. It sits beside the pressable part, because controls must not nest. */
  control?: ReactNode;
  onPress?: () => void;
  role?: 'button' | 'link';
  /** Defaults to on for a pressable row without `control`. */
  chevron?: boolean;
  /** accent.fg title and icon, for actions such as "QR-Code ersetzen". */
  destructive?: boolean;
  disabled?: boolean;
  /** The row of the page on screen, as in the desktop settings pane: state.selected ground and `aria-current`. */
  selected?: boolean;
  divider?: boolean;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  root: { alignItems: 'center', flexDirection: 'row' },
  selected: { backgroundColor: t.color.state.selected },
  box: { flex: 1, minWidth: 0 },
  single: { minHeight: t.size.row.single },
  tall: { minHeight: t.size.row.withThumb },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    paddingVertical: t.space[8],
  },
  thumb: { alignSelf: 'center', flexShrink: 0, width: t.size.thumb.row },
  text: { flex: 1, minWidth: 0 },
  end: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: t.space[8], maxWidth: '50%' },
  value: { flexShrink: 1, textAlign: 'right' },
  control: { flexShrink: 0 },
  // Measures the texts on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
}));

/** From this font scale an adaptive value always takes its own line. */
const STACKED_VALUE_FONT_SCALE = 1.5;

export type AdaptiveValueGeometry = {
  /** The width of the pressable part, its side padding excluded. */
  inner: number;
  /** Thumb or icon plus their gap. */
  lead: number;
  /** One-line widths of the longest word of the title and of the subtitle (0 without one), and of the whole value. */
  titleWord: number;
  subtitleWord: number;
  value: number;
  chevron: boolean;
};

/**
 * Whether the value goes under the text: when the text column beside it is narrower than the longest word of the title or
 * the subtitle, which would then break inside its letters, or when the value would not stay on one line in its half of
 * the row (the trailing part gets 50 % at most). Words may still wrap at their spaces beside it. `null` until measured.
 */
export function adaptiveValueStacks({ inner, lead, titleWord, subtitleWord, value, chevron }: AdaptiveValueGeometry): boolean | null {
  if (inner <= 0 || titleWord <= 0 || value <= 0) return null;
  const end = value + (chevron ? space[8] + size.icon.s : 0);
  if (end > inner / 2) return true;
  const column = inner - lead - space[12] - end;
  return titleWord > column || subtitleWord > column;
}

/**
 * The longest run of a text between its breakable spaces. No-break spaces and word joiners keep a run together, as
 * `keepValuesTogether` and `keepNameTogether` write them, so they do not split it here either.
 */
export function longestWord(text: string): string {
  return text.split(/[ \t\n]+/).reduce((longest, word) => (word.length > longest.length ? word : longest), '');
}

type Widths = { row: number; control: number; titleWord: number; subtitleWord: number; value: number };
const NO_WIDTHS: Widths = { row: 0, control: 0, titleWord: 0, subtitleWord: 0, value: 0 };

/** §8 list row: 56 single, 72 with subtitle; leading icon 20, `body` title, trailing value, chevron 16. */
export function ListRow({
  title,
  subtitle,
  icon,
  thumb,
  value,
  adaptiveValue = false,
  hyphenate = true,
  control,
  onPress,
  role = 'link',
  chevron,
  destructive = false,
  disabled = false,
  selected = false,
  divider = false,
  inset,
  style,
  testID,
}: ListRowProps) {
  const styles = useStyles();
  const theme = useTheme();
  const side = useRowInset(inset);
  const [widths, setWidths] = useState<Widths>(NO_WIDTHS);
  const showChevron = chevron ?? (Boolean(onPress) && !control);
  const lead = thumb ? size.thumb.row + space[12] : icon ? size.icon.m + space[12] : 0;
  const adaptive = adaptiveValue && Boolean(value);
  // At a large font every adaptive row stacks, so the rows of one group keep one shape; below it, the measure decides.
  const stacked =
    adaptive &&
    (theme.fontScale >= STACKED_VALUE_FONT_SCALE ||
      adaptiveValueStacks({
        inner: widths.row - widths.control - side - (control ? 0 : side),
        lead,
        titleWord: widths.titleWord,
        subtitleWord: subtitle ? widths.subtitleWord : 0,
        value: widths.value,
        chevron: showChevron,
      }) === true);
  const tall = Boolean(subtitle || thumb || stacked);
  const padding = { paddingLeft: side, paddingRight: control ? space[0] : side };
  const titleColor = disabled ? 'text.disabled' : destructive ? 'accent.fg' : 'text.primary';
  const iconColor = disabled ? 'text.disabled' : destructive ? 'accent.fg' : 'text.secondary';
  const measured = (key: keyof Widths) => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setWidths((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };
  const valueText = value ? (
    <Text
      variant="supporting"
      color={disabled ? 'text.disabled' : 'text.secondary'}
      style={stacked ? null : styles.value}
      testID={testID ? `${testID}.value` : undefined}
    >
      {value}
    </Text>
  ) : null;

  return (
    <View testID={testID} style={[styles.root, selected ? styles.selected : null, style]} onLayout={adaptive ? measured('row') : undefined}>
      <RowBody
        onPress={onPress}
        role={role}
        disabled={disabled}
        current={selected}
        label={joinLabel([title, subtitle, value])}
        boxStyle={styles.box}
        style={[styles.row, tall ? styles.tall : styles.single, padding]}
        testID={testID ? `${testID}.body` : undefined}
      >
        {thumb ? (
          <Photo {...thumb} aspect="1:1" corner="sm" style={styles.thumb} testID={testID ? `${testID}.thumb` : undefined} />
        ) : icon ? (
          <Icon name={icon} size={20} color={iconColor} />
        ) : null}
        <View style={styles.text}>
          <Text variant="body" color={titleColor} hyphenate={hyphenate}>
            {title}
          </Text>
          {subtitle ? (
            // DQ-318: on a disabled row the subtitle is often the reason it is inert ("Wähle zuerst eine Marke."), so it stays
            // readable (text.tertiary passes AA) while the title shows the state.
            <Text variant="supporting" color={disabled ? 'text.tertiary' : 'text.secondary'} hyphenate={hyphenate}>
              {subtitle}
            </Text>
          ) : null}
          {stacked ? valueText : null}
        </View>
        {(value && !stacked) || showChevron ? (
          <View style={styles.end}>
            {stacked ? null : valueText}
            {showChevron ? <Icon name="caret-right" size={16} color="text.tertiary" /> : null}
          </View>
        ) : null}
      </RowBody>
      {control ? (
        <View style={[styles.control, { paddingLeft: space[12], paddingRight: side }]} onLayout={adaptive ? measured('control') : undefined}>
          {control}
        </View>
      ) : null}
      {divider ? <RowDivider inset={side} lead={lead} /> : null}
      {adaptive ? (
        <View aria-hidden style={styles.measure}>
          <Text variant="body" hyphenate={false} selectable={false} onLayout={measured('titleWord')} testID={testID ? `${testID}.measure.title` : undefined}>
            {longestWord(title)}
          </Text>
          {subtitle ? (
            <Text variant="supporting" hyphenate={false} selectable={false} onLayout={measured('subtitleWord')} testID={testID ? `${testID}.measure.subtitle` : undefined}>
              {longestWord(subtitle)}
            </Text>
          ) : null}
          <Text variant="supporting" hyphenate={false} selectable={false} onLayout={measured('value')} testID={testID ? `${testID}.measure.value` : undefined}>
            {value}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
