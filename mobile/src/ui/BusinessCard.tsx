import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size } from '@/theme';

import { Badge, SampleBadge } from './Badge';
import { Icon } from './icons/Icon';
import { Photo, type PhotoFields } from './Photo';
import { PressableScale } from './PressableScale';
import { joinLabel } from './rowParts';
import { Skeleton, SkeletonBlock, SkeletonText } from './Skeleton';
import { Text } from './Text';

/** At most this many service chips on a card; the profile lists them all. */
const CARD_SERVICES = 3;

export type BusinessCardProps = {
  /** "Beispiel-Werkstatt Nord" */
  name: string;
  /** "Werkstatt · München" */
  subline: string;
  /** "12 km entfernt", only when the list knows a point. */
  distance?: string | null;
  /** Service chips ("Fahrwerk", "Folierung"); the card shows the first three. */
  services?: readonly string[];
  /** The square logo; without one the workshop glyph on surface-2. */
  logo?: PhotoFields | null;
  verified?: boolean;
  /** Sample content (09 §8.19): the "Beispiel" badge. */
  sample?: boolean;
  onPress?: () => void;
  /** No press, hidden from readers: the empty state's preview. */
  inert?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  hover: { backgroundColor: t.color.bg.raised },
  logo: { borderRadius: t.radius.md, height: t.size.avatar.lg, overflow: 'hidden', width: t.size.avatar.lg },
  glyph: { alignItems: 'center', backgroundColor: t.color.bg.raised, justifyContent: 'center' },
  text: { flex: 1, gap: t.space[4], minWidth: 0 },
  badges: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  services: { columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space[4], rowGap: t.space[4] },
  service: {
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
}));

/**
 * 09 §5 BusinessCard: logo 56 radius 12, the name in `headline`, "Werkstatt · München" (+ distance), the Verifiziert badge and up to
 * three service tags. Surface-1, radius 12, no shadow; hover and press step the surface (SM7).
 */
export const BusinessCard = memo(function BusinessCard({
  name,
  subline,
  distance,
  services = [],
  logo,
  verified = false,
  sample = false,
  onPress,
  inert = false,
  style,
  testID,
}: BusinessCardProps) {
  const styles = useStyles();
  const shown = services.slice(0, CARD_SERVICES);
  const caption = distance ? `${subline} · ${distance}` : subline;
  const body = (
    <>
      {logo?.source ? (
        <Photo {...logo} aspect="1:1" corner="md" style={styles.logo} testID={testID ? `${testID}.logo` : undefined} />
      ) : (
        <View style={[styles.logo, styles.glyph]}>
          <Icon name="workshop" size={24} color="text.secondary" />
        </View>
      )}
      <View style={styles.text}>
        <Text variant="headline" numberOfLines={2} testID={testID ? `${testID}.name` : undefined}>
          {name}
        </Text>
        <Text variant="callout" color="text.secondary" numeric testID={testID ? `${testID}.subline` : undefined}>
          {caption}
        </Text>
        {verified || sample ? (
          <View style={styles.badges}>
            {verified ? <Badge kind="verified" testID={testID ? `${testID}.verified` : undefined} /> : null}
            {sample ? <SampleBadge testID={testID ? `${testID}.sample` : undefined} /> : null}
          </View>
        ) : null}
        {shown.length > 0 ? (
          <View style={styles.services}>
            {shown.map((service) => (
              <View key={service} style={styles.service}>
                <Text variant="labelBadge" color="text.secondary" numberOfLines={1}>
                  {service}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
  if (inert || !onPress) {
    return (
      <View aria-hidden={inert ? true : undefined} style={[styles.card, style]} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      role="link"
      aria-label={joinLabel([name, caption, ...shown])}
      onPress={onPress}
      toneShift={false}
      style={style}
      contentStyle={(state) => [styles.card, state.hovered || state.pressed ? styles.hover : null]}
      testID={testID}
    >
      {body}
    </PressableScale>
  );
});

/** The card while a list loads: the logo square, two lines and the tags row. */
export function BusinessCardSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <Skeleton>
      <View style={[styles.card, style]}>
        <SkeletonBlock width={size.avatar.lg} height={size.avatar.lg} corner="md" />
        <View style={styles.text}>
          <SkeletonText variant="headline" width="65%" />
          <SkeletonText variant="callout" width="45%" />
          <SkeletonBlock width="50%" height={size.statusPill} corner="xs" />
        </View>
      </View>
    </Skeleton>
  );
}
