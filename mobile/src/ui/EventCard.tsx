import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size } from '@/theme';

import { SampleBadges, type SampleFlags } from './Badge';
import { Button } from './Button';
import { Photo, type PhotoFields } from './Photo';
import { joinLabel, RowBody } from './rowParts';
import { Skeleton, SkeletonBlock, SkeletonText } from './Skeleton';
import { StatusPill } from './StatusPill';
import { Text } from './Text';

export type EventDateBlockProps = {
  /** "14" (hero.numeral.s, tabular). */
  day: string;
  /** "Juni" (label.caps sets it in capitals). */
  month: string;
  /** "Sa" above the day; left out where the caption already names it. */
  weekday?: string;
  /** A cancelled event's day is struck through in tone, never red. */
  muted?: boolean;
  /** On a photo: `onPhoto` text (ADR-421 b). */
  onPhoto?: boolean;
  testID?: string;
};

export type EventCardRsvp = {
  /** "Zusagen" / "Zugesagt". */
  label: string;
  /** The reader's answer is set: the button shows the check and announces `aria-pressed`. */
  selected: boolean;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export type EventCardProps = {
  day: string;
  month: string;
  weekday?: string;
  /** headline, two lines at most. */
  title: string;
  /** "Hamburg · 18:00–21:00 Uhr" */
  caption: string;
  /** "38 Zusagen · 12 interessiert" (tabular); null on samples (09 §8.19: no invented counts). */
  counts?: string | null;
  /** 16:9 cover above the row (EVT-01's first card, HOME-01 / DISC-01 modules). */
  cover?: PhotoFields | null;
  coverWidth?: number;
  /** DQ-1111: a square thumbnail at the row's end (EVT-05), where the list shows no 16:9 cover. */
  thumb?: PhotoFields | null;
  /** Beispiel / Editorial badges (09 §8.19). */
  sample?: SampleFlags;
  /** "In Prüfung", "Abgesagt", "Entwurf": the organiser's or a cancelled event's state. */
  status?: string | null;
  muted?: boolean;
  rsvp?: EventCardRsvp | null;
  /** A trailing element of the footer instead of the RSVP button (a menu, a remove action). */
  trailing?: ReactNode;
  onPress?: () => void;
  /** A preview that takes no taps (the empty state's sample). */
  inert?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const BLOCK = size.avatar.lg;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[16] },
  block: { alignItems: 'center', minWidth: BLOCK },
  text: { flex: 1, gap: t.space[4], minWidth: 0 },
  badges: {
    alignItems: 'center',
    columnGap: t.space[8],
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: t.space[4],
  },
  // The footer lines up with the text column: a spacer as wide as the date block, then the row (no off-scale padding).
  footerRow: { flexDirection: 'row', gap: t.space[16] },
  spacer: { width: BLOCK },
  footer: {
    alignItems: 'center',
    columnGap: t.space[12],
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    minWidth: 0,
    rowGap: t.space[8],
  },
  counts: { flexGrow: 1, flexShrink: 1 },
  inert: { pointerEvents: 'none' },
  thumb: { width: t.size.thumb.row },
  skeletonDay: { height: t.typography.heroNumeralS.lineHeight, width: BLOCK },
}));

/** 09 §5 EventCard date block: the day as hero.numeral.s over the month as a data label, the weekday above when asked. */
export function EventDateBlock({
  day,
  month,
  weekday,
  muted = false,
  onPhoto = false,
  testID,
}: EventDateBlockProps) {
  const styles = useStyles();
  const primary = onPhoto ? 'onPhoto.primary' : muted ? 'text.tertiary' : 'text.primary';
  const secondary = onPhoto ? 'onPhoto.primary' : 'text.secondary';
  return (
    <View style={styles.block} aria-hidden testID={testID}>
      {weekday ? (
        <Text variant="labelCaps" color={secondary}>
          {weekday}
        </Text>
      ) : null}
      <Text variant="heroNumeralS" numeric color={primary}>
        {day}
      </Text>
      <Text variant="labelCaps" color={secondary}>
        {month}
      </Text>
    </View>
  );
}

/**
 * 09 §5 EventCard (EVT-01, EVT-05, HOME-01 and DISC-01 modules): date block, title (headline, two lines), place and time caption,
 * the answers (tabular) and the RSVP button. The card opens the event; the button sits beside the pressable part, because controls
 * never nest. No box, no shadow: rows on the canvas with the cover in its own radius-12 frame.
 */
export function EventCard({
  day,
  month,
  weekday,
  title,
  caption,
  counts,
  cover,
  coverWidth,
  thumb,
  sample,
  status,
  muted = false,
  rsvp,
  trailing,
  onPress,
  inert = false,
  style,
  testID,
}: EventCardProps) {
  const styles = useStyles();
  const id = (part: string) => (testID ? `${testID}.${part}` : undefined);
  const label = joinLabel([
    title,
    `${weekday ? `${weekday}, ` : ''}${day}. ${month}`,
    caption,
    status,
    counts,
  ]);
  const hasBadges = Boolean(sample?.is_sample || sample?.is_editorial || status);
  return (
    <View
      style={[styles.root, inert ? styles.inert : null, style]}
      aria-hidden={inert || undefined}
      testID={testID}
    >
      <RowBody onPress={inert ? undefined : onPress} label={label} role="link" testID={id('open')}>
        <View style={styles.root}>
          {cover ? (
            <Photo
              {...cover}
              aspect="16:9"
              corner="md"
              style={coverWidth ? { width: coverWidth } : null}
              testID={id('cover')}
            />
          ) : null}
          <View style={styles.row}>
            <EventDateBlock day={day} month={month} weekday={weekday} muted={muted} testID={id('date')} />
            <View style={styles.text}>
              <Text
                variant="headline"
                numberOfLines={2}
                color={muted ? 'text.secondary' : 'text.primary'}
                testID={id('title')}
              >
                {title}
              </Text>
              {/* A date line never hyphenates ("Dezem- / ber" at 412, m4.12-shots): it wraps at its spaces. */}
              <Text variant="caption" color="text.secondary" numeric hyphenate={false} testID={id('caption')}>
                {caption}
              </Text>
              {hasBadges ? (
                <View style={styles.badges}>
                  {status ? <StatusPill label={status} testID={id('status')} /> : null}
                  <SampleBadges flags={sample} />
                </View>
              ) : null}
            </View>
            {thumb && !cover ? (
              <Photo {...thumb} aspect="1:1" corner="sm" style={styles.thumb} testID={id('thumb')} />
            ) : null}
          </View>
        </View>
      </RowBody>
      {counts || rsvp || trailing ? (
        <View style={styles.footerRow}>
          <View style={styles.spacer} />
          <View style={styles.footer}>
            <View style={styles.counts}>
              {counts ? (
                <Text variant="caption" numeric color="text.secondary" testID={id('counts')}>
                  {counts}
                </Text>
              ) : null}
            </View>
            {trailing}
            {rsvp && !trailing ? (
              <Button
                label={rsvp.label}
                size="s"
                variant="secondary"
                icon={rsvp.selected ? 'check' : undefined}
                pressed={rsvp.selected}
                loading={rsvp.loading}
                disabled={rsvp.disabled || inert}
                onPress={rsvp.onPress}
                accessibilityLabel={rsvp.accessibilityLabel}
                testID={id('rsvp')}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The card while it loads, in its geometry (SM15): date block, two text lines, the footer line. */
export function EventCardSkeleton({ cover = false, testID }: { cover?: boolean; testID?: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={testID}>
      <View style={styles.root}>
        {cover ? <SkeletonBlock aspectRatio={16 / 9} corner="md" /> : null}
        <View style={styles.row}>
          <SkeletonBlock style={styles.skeletonDay} corner="sm" />
          <View style={styles.text}>
            <SkeletonText variant="headline" width="80%" />
            <SkeletonText variant="caption" width="60%" />
          </View>
        </View>
        <View style={styles.footerRow}>
          <View style={styles.spacer} />
          <View style={styles.footer}>
            <SkeletonText variant="caption" width="40%" />
          </View>
        </View>
      </View>
    </Skeleton>
  );
}
