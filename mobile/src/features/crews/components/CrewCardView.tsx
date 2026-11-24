import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { CrewCard } from '@/api/queries/crews';
import { photoFields } from '@/features/profile/media';
import { useFormat } from '@/lib/useFormat';
import { createStyles, layout, size } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { SampleBadge } from '@/ui/Badge';
import { Hairline } from '@/ui/Hairline';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { joinLabel } from '@/ui/rowParts';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { crewSubline, crewSublineParts, joinModeLabel } from '../model';
import { FactLine } from './FactLine';

/** The crew's mark on the card: logo or initials, a circle like on CREW-01 (R4DQ-18). */
const MARK = size.avatar.lg;
/** Half the mark hangs over the cover's bottom edge on a card with a cover (09 §5 BusinessCard, ADR-457). */
const MARK_OVERLAP = MARK / 2;

export type CrewCardViewProps = {
  crew: CrewCard;
  onPress?: () => void;
  /** The empty state's preview: no press, hidden from readers. */
  inert?: boolean;
  /**
   * Inside the card, under a hairline and outside the link (controls never nest in a link): CREW-05's "eingeladen von …" with
   * Annehmen/Ablehnen (R4DQ-30), CREW-04's role.
   */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  link: { flexGrow: 1 },
  hover: { backgroundColor: t.color.bg.raised },
  body: { gap: t.space[12], padding: t.space[16] },
  // The mark and, at the far end, the Bundesland's code: the card's typographic anchor without a cover (R4DQ-04).
  top: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', gap: t.space[12] },
  overlap: { marginBottom: -t.space[4], marginTop: -MARK_OVERLAP - t.space[16] },
  // The surface ring (09 §7.7 avatar ring), concentric with the circle (R4DQ-18).
  ring: { alignSelf: 'flex-start', backgroundColor: t.color.bg.surface, borderRadius: t.radius.full, padding: t.space[2] },
  logo: { borderRadius: t.radius.full, height: MARK, overflow: 'hidden', width: MARK },
  region: { flexShrink: 0 },
  text: { gap: t.space[4] },
  // "Hamburg · 12 Mitglieder" with the badge after it, wrapping as a unit (DQ-1154 pattern).
  meta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    marginTop: t.space[4],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  footer: { gap: t.space[12], paddingBottom: t.space[16], paddingHorizontal: t.space[16], paddingTop: t.space[12] },
}));

/**
 * The crew card of CREW-00/01/04/05 (R4DQ-04). A crew with a cover leads with its 16:9 photo and the mark overlapping it. A crew
 * without one shows no photo at all (no stand-in, no "Symbolbild"): a typographic card on surface-1 led by its own data, the logo
 * or initials, the Bundesland's code set large at the far end, the name in `title.2` and "Hamburg · 12 Mitglieder" (a plain fact,
 * never a rank, C2), so two crews never look alike. "Beispiel" on a sample, the join mode as its one tag.
 */
export const CrewCardView = memo(function CrewCardView({ crew, onPress, inert = false, footer, style, testID }: CrewCardViewProps) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const format = useFormat();
  const subline = crewSubline(t, crew, format.number);
  const mode = joinModeLabel(t, crew.join_mode);
  const id = (part: string) => (testID ? `${testID}.${part}` : undefined);

  const mark = crew.logo ? (
    <Photo {...photoFields(crew.logo, MARK)} aspect="1:1" corner="full" style={styles.logo} testID={id('logo')} />
  ) : (
    <Avatar name={crew.name} size={MARK} decorative testID={id('initials')} />
  );
  const regionCode = !crew.cover && crew.bundesland ? (
    // The label is in the meta line; the code is its typographic echo, so readers skip it.
    <Text variant="heroNumeralS" color="text.tertiary" aria-hidden style={styles.region} testID={id('region')}>
      {crew.bundesland}
    </Text>
  ) : null;

  const content = (
    <>
      {crew.cover ? <Photo {...photoFields(crew.cover, layout.feedColumn)} aspect="16:9" testID={id('cover')} /> : null}
      <View style={styles.body}>
        {crew.cover ? (
          crew.logo ? (
            <View style={styles.overlap}>
              <View style={styles.ring}>{mark}</View>
            </View>
          ) : null
        ) : (
          <View style={styles.top}>
            {mark}
            {regionCode}
          </View>
        )}
        <View style={styles.text}>
          <Text variant="title2" testID={id('name')}>
            {crew.name}
          </Text>
          <View style={styles.meta}>
            <FactLine parts={crewSublineParts(t, crew, format.number)} variant="callout" color="text.secondary" testID={id('subline')} />
            {crew.is_sample ? <SampleBadge testID={id('sample')} /> : null}
          </View>
          <View style={styles.tag}>
            <Text variant="labelBadge" color="text.secondary" numberOfLines={1}>
              {mode}
            </Text>
          </View>
        </View>
      </View>
    </>
  );

  const footerView = footer ? (
    <>
      <Hairline inset={layout.cardPadding} insetEnd={layout.cardPadding} />
      <View style={styles.footer}>{footer}</View>
    </>
  ) : null;

  if (inert || !onPress) {
    return (
      <View aria-hidden={inert ? true : undefined} style={[styles.card, style]} testID={testID}>
        {content}
        {footerView}
      </View>
    );
  }
  const link = (
    <PressableScale
      role="link"
      aria-label={joinLabel([crew.name, subline, mode])}
      onPress={onPress}
      toneShift={false}
      style={footer ? styles.link : style}
      contentStyle={(state) => [footer ? null : styles.card, state.hovered || state.pressed ? styles.hover : null]}
      testID={testID}
    >
      {content}
    </PressableScale>
  );
  if (!footer) return link;
  return (
    <View style={[styles.card, style]}>
      {link}
      {footerView}
    </View>
  );
});

/**
 * The card while a list loads: the typographic card's geometry (mark, name, meta line, tag), the shape most crews have, and the
 * footer's lines when the loaded card has one (CREW-05).
 */
export function CrewCardSkeleton({ footer, style }: { footer?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <Skeleton style={style}>
      <View style={styles.card}>
        <View style={styles.body}>
          <SkeletonBlock width={MARK} height={MARK} corner="full" />
          <View style={styles.text}>
            <SkeletonText variant="title2" width="70%" />
            <SkeletonText variant="callout" width="45%" />
            <SkeletonBlock width="30%" height={size.statusPill} corner="xs" />
          </View>
        </View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Skeleton>
  );
}
