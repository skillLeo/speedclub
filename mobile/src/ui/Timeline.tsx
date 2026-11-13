import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, useTheme } from '@/theme';

import { Icon } from './icons/Icon';
import { BeforeAfter } from './motion/BeforeAfter';
import { Photo, type PhotoFields } from './Photo';
import { joinLabel, RowBody, useStacksAtFontScale } from './rowParts';
import { WEB_HAIRLINE } from './specStripLayout';
import { Text, typeStyle } from './Text';
import { timelineGroups, TIMELINE_PHOTOS_MAX } from './timelineLayout';
import { ValueText } from './ValueText';

export type TimelineLine = {
  key: string;
  /** "Fahrwerk" */
  label: string;
  /** "Serie → KW V3 · −35 mm" */
  detail?: string;
  /**
   * DQ-977: one meta line "Fahrwerk · −35 mm" under a title that already names the change, instead of the system as a caption
   * over its change.
   */
  inline?: boolean;
};

export type TimelineEntry = {
  key: string;
  /** The group the entry belongs to: "Juni 2026". Entries in a row with the same date share one heading. */
  date: string;
  /** "Fahrwerk geändert" */
  title: string;
  lines?: readonly TimelineLine[];
  note?: string;
  /** "und 2 weitere Änderungen" */
  more?: string;
  /** Up to three photos of the update, in a 3-up grid. */
  photos?: readonly (PhotoFields & { alt?: string })[];
  /** "48.200 km", tabular. */
  mileage?: string;
  /** A paired update: the SM17 slider instead of the grid. */
  beforeAfter?: {
    before: PhotoFields & { label: string };
    after: PhotoFields & { label: string };
    label: string;
  };
  /** Opens the update (VEH-05). */
  onPress?: () => void;
  /** Overrides `<testID>.entry.<key>` (VEH-01 keeps `VEH-01.update.<id>`). */
  testID?: string;
};

export type TimelineProps = {
  entries: readonly TimelineEntry[];
  style?: StyleProp<ViewStyle>;
  /** Sub-testIDs: `.group.<n>`, `.entry.<key>`, `.entry.<key>.photos`, `.entry.<key>.beforeAfter`. */
  testID?: string;
  /** Overrides `<testID>.group.<n>` (VEH-01 keeps `VEH-01.month.<n>`). */
  groupTestID?: (index: number) => string;
};

const SPINE = isWeb ? WEB_HAIRLINE : StyleSheet.hairlineWidth;

const useStyles = createStyles((t) => ({
  beforeAfterFrame: { borderRadius: t.radius.sm, overflow: 'hidden' },
  group: { marginTop: t.space[24] },
  groupFirst: { marginTop: 0 },
  spine: {
    borderLeftColor: t.color.border.default,
    borderLeftWidth: SPINE,
    marginLeft: t.space[4],
    marginTop: t.space[8],
  },
  entry: { paddingBottom: t.space[8] },
  // The node sits on the spine, centred on the title's first line.
  node: {
    backgroundColor: t.color.text.tertiary,
    borderRadius: t.radius.full,
    height: t.space[8],
    left: -(t.space[8] + SPINE) / 2,
    position: 'absolute',
    top: t.space[8] + (t.typography.headline.lineHeight - t.space[8]) / 2,
    width: t.space[8],
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: t.space[8],
    paddingLeft: t.space[16],
    paddingRight: t.space[8],
    paddingVertical: t.space[8],
  },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  line: { gap: t.space[2] },
  lineInline: { alignItems: 'baseline', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap' },
  caret: { paddingTop: t.space[4] },
  media: { marginLeft: t.space[16], marginTop: t.space[4] },
  photos: { flexDirection: 'row', gap: t.space[4] },
  photo: { flex: 1 },
}));

/**
 * 09 §5 Timeline (VEH-01 Verlauf): a hairline spine with a node per entry; per month a heading (`callout.strong`, the 2.0
 * scale has no 12/600 role; ADR-426 e maps section headers the same way); an entry is its title (`headline`), its changes
 * (label in `body.strong`, the change in `callout`), the note, the mileage (tabular), and its photos: a 3-up grid, or the SM17
 * before/after slider for a paired update. The text part opens the update; the photos and the slider are their own controls.
 */
export function Timeline({ entries, style, testID, groupTestID }: TimelineProps) {
  const styles = useStyles();
  const groups = timelineGroups(entries);
  return (
    <View style={style} testID={testID}>
      {groups.map((group, index) => (
        <View
          key={`${group.date}-${index}`}
          style={index === 0 ? styles.groupFirst : styles.group}
          testID={groupTestID ? groupTestID(index) : testID ? `${testID}.group.${index}` : undefined}
        >
          {group.date ? (
            <Text variant="calloutStrong" color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)}>
              {group.date}
            </Text>
          ) : null}
          <View style={styles.spine}>
            {group.entries.map((entry) => (
              <TimelineItem key={entry.key} entry={entry} testID={entry.testID ?? (testID ? `${testID}.entry.${entry.key}` : undefined)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function TimelineItem({ entry, testID }: { entry: TimelineEntry; testID?: string }) {
  const styles = useStyles();
  const theme = useTheme();
  // DQ-982: the node centres on the title's first line at the scale the title renders with, also at 200 %.
  const titleLine = typeStyle('headline', theme.fontScale).lineHeight ?? theme.typography.headline.lineHeight;
  const nodeTop = { top: theme.space[8] + (titleLine - theme.space[8]) / 2 };
  const largeFont = useStacksAtFontScale();
  const photos = (entry.photos ?? []).slice(0, TIMELINE_PHOTOS_MAX);
  const label = joinLabel([
    entry.title,
    ...(entry.lines ?? []).flatMap((line) => [line.label, line.detail]),
    entry.note,
    entry.mileage,
    entry.more,
  ]);
  return (
    <View style={styles.entry}>
      <View aria-hidden style={[styles.node, nodeTop]} testID={testID ? `${testID}.node` : undefined} />
      <RowBody onPress={entry.onPress} label={label} style={styles.row} testID={testID}>
        <View style={styles.text}>
          <Text variant="headline">{entry.title}</Text>
          {(entry.lines ?? []).map((line) =>
            line.inline ? (
              <View key={line.key} style={styles.lineInline}>
                <Text variant="caption" color="text.secondary">
                  {line.label}
                </Text>
                {line.detail ? (
                  <>
                    <Text variant="caption" color="text.secondary" aria-hidden>
                      ·
                    </Text>
                    <ValueText variant="caption" color="text.secondary" hyphenate={false} values={line.detail} wholeValues />
                  </>
                ) : null}
              </View>
            ) : (
              <View key={line.key} style={styles.line}>
                {/* DQ-955: the system is a caption over its change, never a second headline under the title. */}
                <Text variant="caption" color="text.secondary">
                  {line.label}
                </Text>
                {line.detail ? (
                  <ValueText variant="callout" color="text.secondary" hyphenate={largeFont} values={line.detail} wholeValues={!largeFont} />
                ) : null}
              </View>
            ),
          )}
          {entry.note ? (
            <Text variant="callout" color="text.secondary">
              {entry.note}
            </Text>
          ) : null}
          {entry.mileage ? (
            <Text variant="caption" color="text.secondary" numeric hyphenate={false} testID={testID ? `${testID}.mileage` : undefined}>
              {entry.mileage}
            </Text>
          ) : null}
          {entry.more ? (
            <Text variant="caption" color="text.tertiary">
              {entry.more}
            </Text>
          ) : null}
        </View>
        {entry.onPress ? (
          <View style={styles.caret}>
            <Icon name="caret-right" size={16} color="text.tertiary" />
          </View>
        ) : null}
      </RowBody>
      {entry.beforeAfter ? (
        // DQ-968: inset media are radius 8, as the 3-up photos beside it.
        <View style={[styles.media, styles.beforeAfterFrame]}>
          <BeforeAfter
            before={entry.beforeAfter.before}
            after={entry.beforeAfter.after}
            aspect="4:3"
            label={entry.beforeAfter.label}
            testID={testID ? `${testID}.beforeAfter` : 'timeline.beforeAfter'}
          />
        </View>
      ) : photos.length > 0 ? (
        <View style={[styles.media, styles.photos]} testID={testID ? `${testID}.photos` : undefined}>
          {photos.map((photo, index) => (
            <Photo key={index} {...photo} label={photo.alt} aspect="1:1" corner="sm" style={styles.photo} />
          ))}
          {/* Fewer than three keep the 3-up size. */}
          {Array.from({ length: TIMELINE_PHOTOS_MAX - photos.length }, (_, index) => (
            <View key={`empty-${index}`} style={styles.photo} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
