import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space, useTheme } from '@/theme';
import { Chip, Icon, PressableScale, Radio, SegmentedControl, Switch, Text, type SegmentedControlProps } from '@/ui';
import { SECTION_HEADER_ROLE } from '@/ui/RowGroup';
import { useStacksAtFontScale } from '@/ui/rowParts';

const useStyles = createStyles((t) => ({
  // ADR-426 e: space.32 above a group (the form column's space.24 + space.8; the first group sits space.24 below the column's
  // space.16 top padding), space.16 between fields, space.8 below the header (pulled up from the fields' 16).
  group: { gap: t.space[16], marginTop: t.space[8] },
  groupTitle: { marginBottom: t.space[8] - t.space[16] },
  pair: { flexDirection: 'row', gap: t.space[12] },
  pairStacked: { gap: t.space[16] },
  pairItem: { flex: 1, minWidth: 0 },
  field: { gap: t.space[8] },
  surface: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    gap: t.space[8],
    minHeight: t.size.input,
    paddingLeft: t.space[16],
    paddingRight: t.space[12],
    paddingVertical: t.space[12],
  },
  frame: { borderColor: t.color.border.control, borderRadius: t.radius.sm, borderWidth: t.size.border.control, pointerEvents: 'none' },
  frameHover: { borderColor: t.color.text.secondary },
  frameError: { borderColor: t.color.accent.fg },
  frameFocus: { borderColor: t.color.text.primary, borderWidth: t.size.border.inputFocus },
  frameDisabled: { borderColor: t.color.border.default },
  value: { flex: 1, minWidth: 0 },
  note: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[4], marginTop: -t.space[4] },
  noteIcon: { paddingTop: t.space[2] },
  noteText: { flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single },
  switchText: { flex: 1, gap: t.space[2], minWidth: 0 },
  // Measures the labels on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
}));

export type FormGroupProps = {
  /** Section header in sentence case: one or two short words ("Motor", "Dieses Fahrzeug"). */
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * FS-5: a section header, 16 between fields. The header is the grouped-list role (ADR-426 e, `SECTION_HEADER_ROLE`:
 * callout.strong 14/20 600, text.secondary), the same as RowGroup's, one weight step above the field labels (DQ-928); v1's
 * caps eyebrow became a 17 headline in the M4.1 mapping, which grew to near title size at 200 % (DQ-906). Every group, with
 * or without a header, adds space.8 above itself to its parent's space.24: space.32 between groups (ADR-426 e). A group of
 * one field whose label says it all has no header (it would repeat the label).
 */
export function FormGroup({ title, children, style, testID }: FormGroupProps) {
  const styles = useStyles();
  return (
    <View style={[styles.group, style]} testID={testID}>
      {title ? (
        <Text
          variant={SECTION_HEADER_ROLE}
          color="text.secondary"
          role="heading"
          {...({ 'aria-level': 2 } as object)}
          hyphenate={false}
          style={styles.groupTitle}
          testID={testID ? `${testID}.title` : undefined}
        >
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** Two fields side by side (FS-6 "vorne / hinten"); stacked once a large font leaves no room. */
export function FieldPair({ children, testID }: { children: readonly [ReactNode, ReactNode]; testID?: string }) {
  const styles = useStyles();
  const stacked = useStacksAtFontScale();
  return (
    <View style={stacked ? styles.pairStacked : styles.pair} testID={testID}>
      <View style={stacked ? null : styles.pairItem}>{children[0]}</View>
      <View style={stacked ? null : styles.pairItem}>{children[1]}</View>
    </View>
  );
}

export type FieldNoteProps = { helper?: string; error?: string; testID?: string };

/** Helper or error under a field: icon and text, never colour alone (§8). */
export function FieldNote({ helper, error, testID }: FieldNoteProps) {
  const styles = useStyles();
  const note = error ?? helper;
  if (!note) return null;
  return (
    <View style={styles.note}>
      {error ? (
        <View style={styles.noteIcon}>
          <Icon name="warning" size={16} color="accent.fg" />
        </View>
      ) : null}
      <Text
        variant="caption"
        color={error ? 'accent.fg' : 'text.secondary'}
        role={error ? 'alert' : undefined}
        style={styles.noteText}
        testID={testID ? `${testID}.${error ? 'error' : 'helper'}` : undefined}
      >
        {note}
      </Text>
    </View>
  );
}

export type PickerFieldProps = {
  label: string;
  /** The chosen option's label; the placeholder shows when there is none. */
  value?: string | null;
  placeholder: string;
  onPress: () => void;
  helper?: string;
  error?: string;
  disabled?: boolean;
  testID?: string;
};

/**
 * A field that opens a picker sheet (§9 "pickers — bottom sheets"): the text input's box, label above and helper below,
 * with a caret instead of a caret cursor. Its name carries the value: "Kraftstoff: Benzin".
 */
export function PickerField({ label, value, placeholder, onPress, helper, error, disabled = false, testID }: PickerFieldProps) {
  const styles = useStyles();
  const shown = value && value.trim() !== '' ? value : null;
  return (
    <View style={styles.field}>
      <Text variant="callout" color="text.secondary" aria-hidden>
        {label}
      </Text>
      <PressableScale
        role="button"
        aria-label={`${label}: ${shown ?? placeholder}`}
        aria-haspopup="dialog"
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        feedback={false}
        onPress={onPress}
        testID={testID}
        contentStyle={styles.surface}
      >
        {(state) => (
          <>
            <Text
              variant="body"
              color={disabled ? 'text.disabled' : shown ? 'text.primary' : 'text.tertiary'}
              hyphenate={false}
              selectable={false}
              style={styles.value}
              testID={testID ? `${testID}.value` : undefined}
            >
              {shown ?? placeholder}
            </Text>
            <Icon name="caret-down" size={20} color={disabled ? 'text.disabled' : 'text.secondary'} />
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.frame,
                disabled ? styles.frameDisabled : null,
                !disabled && state.hovered ? styles.frameHover : null,
                error ? styles.frameError : null,
                state.focused && !error ? styles.frameFocus : null,
              ]}
            />
          </>
        )}
      </PressableScale>
      <FieldNote helper={helper} error={error} testID={testID} />
    </View>
  );
}

export type ChoiceChipsProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | '';
  /** Tapping the chosen chip again clears it. */
  onChange: (next: T | '') => void;
  disabled?: boolean;
  /** DQ-169: a few chips that do not fit one row share two even columns, so the last one is not left alone at its own width. */
  evenRows?: boolean;
  testID?: string;
};

/** §8 chip: 12 of padding and 1 of border on each side of the label. */
const CHIP_CHROME = 2 * space[12] + 2 * size.border.control;
const CHIP_GAP = space[8];

/**
 * How chips with these label widths sit in a track: all on one row, in two even columns, or (a large font, where even a
 * column is too narrow) wrapped at their own widths. `null` until measured, which is the plain wrapping row.
 */
export function evenChipLayout(track: number, labels: readonly number[]): 'row' | 'columns' | 'wrap' | null {
  if (track <= 0 || labels.length === 0 || labels.some((width) => width <= 0)) return null;
  const chips = labels.map((width) => width + CHIP_CHROME);
  if (chips.reduce((sum, chip) => sum + chip, 0) + CHIP_GAP * (chips.length - 1) <= track) return 'row';
  return Math.max(...chips) <= (track - CHIP_GAP) / 2 ? 'columns' : 'wrap';
}

/** FS-5's provenance chips (Herstellerangabe · Geschätzt · Prüfstand): a radio group of chips that can also be left empty. */
export function ChoiceChips<T extends string>({ label, options, value, onChange, disabled = false, evenRows = false, testID }: ChoiceChipsProps<T>) {
  const styles = useStyles();
  const [track, setTrack] = useState(0);
  const [labels, setLabels] = useState<Record<string, number>>({});
  const measured = (key: string) => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setLabels((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };
  const columns = evenRows && evenChipLayout(track, options.map((option) => labels[option.value] ?? 0)) === 'columns';
  const column = columns ? { width: (track - CHIP_GAP) / 2 } : null;
  return (
    <View
      role="radiogroup"
      aria-label={label}
      style={styles.chips}
      onLayout={evenRows ? (event) => setTrack(event.nativeEvent.layout.width) : undefined}
      testID={testID}
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={value === option.value}
          selectionRole="radio"
          disabled={disabled}
          onPress={() => onChange(value === option.value ? '' : option.value)}
          style={column}
          testID={testID ? `${testID}.${option.value}` : undefined}
        />
      ))}
      {evenRows ? (
        <View aria-hidden style={styles.measure}>
          {options.map((option) => (
            <Text key={option.value} variant="callout" hyphenate={false} selectable={false} onLayout={measured(option.value)}>
              {option.label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export type SwitchRowProps = {
  label: string;
  helper?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
};

/** A labelled switch on its own line, 56 high: "Mischbereifung", "Öffentlich zeigen". */
export function SwitchRow({ label, helper, value, onChange, disabled = false, testID }: SwitchRowProps) {
  const styles = useStyles();
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text variant="body" color={disabled ? 'text.disabled' : 'text.primary'}>
          {label}
        </Text>
        {helper ? (
          <Text variant="caption" color="text.secondary">
            {helper}
          </Text>
        ) : null}
      </View>
      <Switch label={label} value={value} onValueChange={onChange} disabled={disabled} testID={testID} />
    </View>
  );
}

/** "123 / 500" under a long text. */
export function useCharCount() {
  const { t } = useTranslation('garage');
  return (count: number, max: number) => t('form.charCount', { count, max });
}

/** SegmentedControl's track inset (2) and the padding of a segment's label (8 each side). */
const SEGMENT_CHROME = space[2] * 2;
const SEGMENT_LABEL_PADDING = space[8] * 2;
/** Until the labels are measured, from this font scale the choice is a radio list. */
const RADIO_FONT_SCALE = 1.5;

/**
 * Whether every label fits its share of the track on one line, `null` until measured. Beyond it the segmented control would
 * scroll and cut its last label (DQ-155: "Entfe" for "Entfernt" at 200 %).
 */
export function segmentsFit(track: number, labels: readonly number[]): boolean | null {
  if (track <= 0 || labels.length === 0 || labels.some((width) => width <= 0)) return null;
  const segment = (track - SEGMENT_CHROME) / labels.length;
  return Math.max(...labels) + SEGMENT_LABEL_PADDING <= segment;
}

/**
 * A form choice of up to three options (§8 segmented control, FS-6 status) that never cuts a label: the segmented control
 * while every label fits its share of the track, the same choice as a radio list once one does not (a large font, a long
 * translation). Same value, same test IDs per option.
 */
export function FittingSegmented<T extends string>(props: Omit<SegmentedControlProps<T>, 'role'>) {
  const { options, value, onChange, label, disabled = false, style, testID } = props;
  const styles = useStyles();
  const theme = useTheme();
  const [track, setTrack] = useState(0);
  const [labels, setLabels] = useState<Record<string, number>>({});
  const measured = (key: string) => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setLabels((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };
  const fits = segmentsFit(track, options.map((option) => labels[option.value] ?? 0)) ?? theme.fontScale < RADIO_FONT_SCALE;

  return (
    <View style={style} onLayout={(event) => setTrack(event.nativeEvent.layout.width)}>
      {fits ? (
        <SegmentedControl {...props} role="radiogroup" style={undefined} />
      ) : (
        <View role="radiogroup" aria-label={label} testID={testID}>
          {options.map((option) => (
            <Radio
              key={option.value}
              label={option.label}
              showLabel
              alignFirstLine
              checked={option.value === value}
              disabled={disabled || option.disabled === true}
              onChange={() => {
                if (option.value !== value) onChange(option.value);
              }}
              testID={option.testID ?? (testID ? `${testID}.${option.value}` : undefined)}
            />
          ))}
        </View>
      )}
      <View aria-hidden style={styles.measure}>
        {options.map((option) => (
          <Text key={option.value} variant="callout" hyphenate={false} selectable={false} onLayout={measured(option.value)}>
            {option.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
