import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { createStyles, size, space } from '@/theme';
import { Icon, StatusPill, Text, type IconName } from '@/ui';
import { endsWord, joinLabel, RowBody, RowDivider, useStacksAtFontScale } from '@/ui/rowParts';
import { metaLineText, vehicleNameText } from '@/ui/textBreaks';

/** The rows sit 16 inside their card, as on every settings page (FS-12). */
const INSET = space[16];

const useStyles = createStyles((t) => ({
  // One piece of the group's card: the first row rounds its top, the last its bottom, so a FlashList can still recycle rows.
  card: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  cardFirst: { borderTopLeftRadius: t.radius.md, borderTopRightRadius: t.radius.md },
  cardLast: { borderBottomLeftRadius: t.radius.md, borderBottomRightRadius: t.radius.md },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    paddingHorizontal: INSET,
    paddingVertical: t.space[8],
  },
  empty: { justifyContent: 'center', minHeight: t.size.row.withThumb, paddingHorizontal: INSET, paddingVertical: t.space[12] },
  text: { flex: 1, minWidth: 0 },
  stackedPill: { alignItems: 'flex-start', marginTop: t.space[4] },
  end: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: t.space[8] },
}));

/** A piece of an FS-12 inset group's card (bg.surface, radius 12), for lists whose rows are separate FlashList items. */
export function GroupCard({ first, last, children, testID }: { first: boolean; last: boolean; children: ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, first ? styles.cardFirst : null, last ? styles.cardLast : null]} testID={testID}>
      {children}
    </View>
  );
}

export type ReportRowProps = {
  icon: IconName;
  /** "Foto von Audi RS2 Avant": a name, never hyphenated. */
  title: string;
  /** "Spam · 06.11.2026" */
  subtitle: string;
  /** "In Prüfung", "Entschieden" */
  status: string;
  /** Opens SAFE-01; a report still under review opens nothing and shows no chevron. */
  onPress?: () => void;
  divider: boolean;
  /** `.body` on the pressable part, `.status` on the pill. */
  testID: string;
};

/**
 * SET-16 (DQ-421): the 72 row of FS-12 with a subtitle, glyph 20, the status pill trailing and the chevron when it opens SAFE-01.
 * From the stacking font scale the pill takes its own line under the text, as on the mod row (DQ-180).
 */
/** DQ-456: a vehicle name stays whole, and a short trailing code ("C8", "E46") never ends up alone on its line. */
export function reportTitleText(title: string): string {
  return vehicleNameText(title).replace(/ (\S{1,3})$/u, '\u00a0$1');
}

export const ReportRow = memo(function ReportRow({ icon, title, subtitle, status, onPress, divider, testID }: ReportRowProps) {
  const styles = useStyles();
  const stacked = useStacksAtFontScale();
  const pill = <StatusPill label={status} testID={`${testID}.status`} />;
  return (
    <View testID={testID}>
      <RowBody onPress={onPress} label={joinLabel([title, subtitle, status])} style={styles.row} testID={`${testID}.body`}>
        <Icon name={icon} size={20} color="text.secondary" />
        <View style={styles.text}>
          <Text variant="body" hyphenate={false}>
            {endsWord(reportTitleText(title), true)}
          </Text>
          <Text variant="supporting" color="text.secondary" hyphenate={false}>
            {/* DQ-445a: "Inhalt entfernt · 23.10.2026" wraps before its "·", never right after it. */}
            {endsWord(metaLineText(subtitle, undefined, 'starts'), true)}
          </Text>
          {stacked ? <View style={styles.stackedPill}>{pill}</View> : null}
        </View>
        {!stacked || onPress ? (
          <View style={styles.end}>
            {stacked ? null : pill}
            {onPress ? <Icon name="caret-right" size={16} color="text.tertiary" /> : null}
          </View>
        ) : null}
      </RowBody>
      {divider ? <RowDivider inset={INSET} lead={size.icon.m + space[12]} /> : null}
    </View>
  );
});

/** The section's empty line as the one row of its card: title and a supporting line, 72 at least. */
export function EmptyGroupRow({ title, body, testID }: { title: string; body: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.empty} testID={testID}>
      <Text variant="body">{endsWord(title, true)}</Text>
      <Text variant="supporting" color="text.secondary">
        {body}
      </Text>
    </View>
  );
}
