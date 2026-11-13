import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { keepShortNamesTogether } from '@/lib/format';
import { createStyles, size, space } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { useMotionPreference } from './motion';
import { PressableScale } from './PressableScale';
import { joinLabel, RowBody, RowDivider, useStacksAtFontScale } from './rowParts';
import { StatusPill } from './StatusPill';
import { Text } from './Text';
import { ValueText } from './ValueText';

export type BuildSheetMod = {
  key: string;
  /** The category glyph (auto glyph set 2.0). */
  icon: IconName;
  /** "BBS LM" */
  name: string;
  /** "BBS": the brand, in caption under the name. */
  brand?: string | null;
  /** The key values, tabular: "19″ × 9,5J ET35 · 255/35 R19". */
  values?: string;
  /** "Verbaut", "Geplant" */
  status?: string;
  /** [SIG `sig.mod_legal_status`] the owner's stated legal status, a second pill. */
  legalStatus?: string;
  legalStatusLabel?: string;
  /** Shown when the row expands inline: "Eingebaut · März 2023". Without details the row has no expand control. */
  details?: readonly { label: string; value: string }[];
  /** Opens the mod (VEH-02). */
  onPress?: () => void;
  testID?: string;
};

export type BuildSheetSection = {
  key: string;
  /** "Fahrwerk" */
  title: string;
  icon: IconName;
  count: number;
  /** "3 Mods": how screen readers hear the count. */
  countLabel: string;
  mods: readonly BuildSheetMod[];
  testID?: string;
};

export type BuildSheetProps = {
  sections: readonly BuildSheetSection[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const NO_BREAK_SPACE = '\u00A0';

/** The row's side padding, as the grouped lists of VEH-01 (`RowCard`). */
const ROW_INSET = space[16];

const useStyles = createStyles((t) => ({
  section: { marginTop: t.space[32] },
  sectionFirst: { marginTop: 0 },
  header: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], marginBottom: t.space[12] },
  headerTitle: { flexShrink: 1 },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  line: { alignItems: 'stretch', flexDirection: 'row' },
  body: { flex: 1, minWidth: 0 },
  // DQ-952: one alignment per row: tile, title line and chevron share the tile's centre line; pills and values sit below.
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.mod, paddingHorizontal: ROW_INSET, paddingVertical: t.space[12] },
  chevron: { height: t.size.modTile, justifyContent: 'center' },
  rowBeforeToggle: { paddingRight: 0 },
  // 09 §5: glyph 24 in a 40 surface-2 tile, radius 8 (the one neutral glyph tile the design allows).
  tile: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    height: t.size.modTile,
    justifyContent: 'center',
    width: t.size.modTile,
  },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  titleLine: { justifyContent: 'center', minHeight: t.size.modTile },
  pills: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space[4], rowGap: t.space[4] },
  end: { justifyContent: 'center', paddingRight: t.space[4] },
  toggle: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  details: { gap: t.space[8], paddingBottom: t.space[16], paddingLeft: ROW_INSET + t.size.modTile + t.space[12], paddingRight: ROW_INSET },
  detail: { gap: t.space[2] },
}));

/**
 * 09 §5 BuildSheet: the build by system (Motor · Abgasanlage · Fahrwerk · Bremsen · Räder & Reifen · Aero & Karosserie ·
 * Innenraum · Elektronik · Antrieb, in the order the API gives), each with its glyph, `headline` and the count in tabular
 * figures, over a grouped card of mod rows. A row (ModRow 2.0) is at least 64: the glyph 24 in a 40 tile, the part name in
 * `headline` over the full width, the brand in `caption`, the key values tabular, the status and legal pills on one line under
 * them; the row opens the mod (chevron on the title line), and a row with details
 * expands inline with its own control (spring.default; reduced motion crossfades).
 */
export function BuildSheet({ sections, style, testID }: BuildSheetProps) {
  const styles = useStyles();
  return (
    <View style={style} testID={testID}>
      {sections.map((section, index) => (
        <View key={section.key} style={index === 0 ? styles.sectionFirst : styles.section} testID={section.testID ?? (testID ? `${testID}.${section.key}` : undefined)}>
          <View style={styles.header}>
            <Icon name={section.icon} size={24} color="text.secondary" />
            {/* DQ-180: the count stands behind a no-break space in the heading's own line, so it never sits alone. */}
            <Text
              variant="headline"
              role="heading"
              {...({ 'aria-level': 2 } as object)}
              aria-label={joinLabel([section.title, section.countLabel])}
              style={styles.headerTitle}
            >
              {section.title}
              {NO_BREAK_SPACE}
              <Text variant="callout" color="text.tertiary" numeric testID={section.testID ? `${section.testID}.count` : undefined}>
                {String(section.count)}
              </Text>
            </Text>
          </View>
          <View style={styles.card}>
            {section.mods.map((mod, rowIndex) => (
              <BuildSheetRow key={mod.key} mod={mod} divider={rowIndex < section.mods.length - 1} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** One mod of the sheet (ModRow 2.0). */
export function BuildSheetRow({ mod, divider = false }: { mod: BuildSheetMod; divider?: boolean }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const motion = useMotionPreference();
  const largeFont = useStacksAtFontScale();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const details = mod.details ?? [];
  const expandable = details.length > 0;
  const turn = useSharedValue(0);
  const reveal = useSharedValue(0);
  const { testID } = mod;

  useEffect(() => {
    turn.set(motion.springTo(open ? 1 : 0, 'fast'));
    reveal.set(open ? motion.springTo(1, 'default') : 0);
  }, [open, motion, turn, reveal]);

  const caretStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${interpolate(turn.get(), [0, 1], [0, 180])}deg` }] }));
  const detailsStyle = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    transform: motion.reduced ? [] : [{ translateY: interpolate(reveal.get(), [0, 1], [-space[8], 0]) }],
  }));

  const statusPill = mod.status ? <StatusPill label={mod.status} testID={testID ? `${testID}.status` : undefined} /> : null;
  const legalName = mod.legalStatus ? (mod.legalStatusLabel ?? mod.legalStatus) : undefined;
  const legalPill = mod.legalStatus ? (
    <View accessible aria-label={legalName} testID={testID ? `${testID}.legalStatus` : undefined}>
      <StatusPill label={mod.legalStatus} />
    </View>
  ) : null;

  return (
    <View testID={testID}>
      <View style={styles.line}>
        <RowBody
          onPress={mod.onPress}
          label={joinLabel([mod.name, mod.brand, mod.values, mod.status, legalName])}
          boxStyle={styles.body}
          style={[styles.row, expandable ? styles.rowBeforeToggle : null]}
          testID={testID ? `${testID}.body` : undefined}
        >
          <View style={styles.tile}>
            <Icon name={mod.icon} size={24} color="text.secondary" />
          </View>
          <View style={styles.text}>
            {/* DQ-1079 (DQ-1043): the title line is centred on the tile by a box of the tile's height, never by an off-scale padding. */}
            <View style={styles.titleLine}>
              <Text variant="headline">{keepShortNamesTogether(mod.name)}</Text>
            </View>
            {mod.brand ? (
              <Text variant="caption" color="text.secondary" hyphenate={false}>
                {mod.brand}
              </Text>
            ) : null}
            {mod.values ? <ValueText variant="callout" color="text.secondary" hyphenate={largeFont} values={mod.values} wholeValues={!largeFont} /> : null}
            {/* DQ-952: the pills (install status, legal status) on one line under the value at every size, so the title keeps the row's width. */}
            {statusPill || legalPill ? (
              <View style={styles.pills}>
                {statusPill}
                {legalPill}
              </View>
            ) : null}
          </View>
          {mod.onPress && !expandable ? (
            <View style={styles.chevron}>
              <Icon name="caret-right" size={16} color="text.tertiary" />
            </View>
          ) : null}
        </RowBody>
        {expandable ? (
          <View style={styles.end}>
            <PressableScale
              role="button"
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={t(open ? 'buildSheet.collapse' : 'buildSheet.expand', { name: mod.name })}
              onPress={() => setOpen((value) => !value)}
              style={styles.toggle}
              testID={testID ? `${testID}.toggle` : undefined}
            >
              <Animated.View style={caretStyle}>
                <Icon name="caret-down" size={16} color="text.tertiary" />
              </Animated.View>
            </PressableScale>
          </View>
        ) : null}
      </View>
      {expandable && open ? (
        <Animated.View nativeID={detailsId} style={[styles.details, detailsStyle]} testID={testID ? `${testID}.details` : undefined}>
          {details.map((detail) => (
            <View key={detail.label} style={styles.detail}>
              <Text variant="caption" color="text.secondary">
                {detail.label}
              </Text>
              <ValueText variant="body" values={detail.value} />
            </View>
          ))}
        </Animated.View>
      ) : null}
      {divider ? <RowDivider inset={ROW_INSET} lead={size.modTile + space[12]} /> : null}
    </View>
  );
}
