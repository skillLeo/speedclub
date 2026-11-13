import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';

import { Icon } from './icons/Icon';
import { Text } from './Text';

/**
 * 09 §5 Badge kinds. `sample` is mandatory on all sample content (09 §8.19), `editorial` marks the SPEED CLUB Editorial
 * account that owns the sample builds. A badge is never red.
 */
export type BadgeKind = 'sample' | 'editorial' | 'verified' | 'business' | 'founding' | 'dyno';

export type BadgeProps = {
  kind: BadgeKind;
  /** `onPhoto`: drawn on a photo or scrim, on the photo chip ground with `onPhoto.primary` text (ADR-421 b). */
  tone?: 'default' | 'onPhoto';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const LABEL_KEY: Record<BadgeKind, string> = {
  sample: 'badges.sample',
  editorial: 'badges.editorial',
  verified: 'badges.verified',
  business: 'badges.business',
  founding: 'badges.founding',
  dyno: 'badges.dyno',
};

const useStyles = createStyles((t) => ({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    // 09 §5 "surface-3" on the dark themes. ADR-431 d (DQ-960): Hell's tonal steps run the other way and bg.raised all but
    // vanished on its canvas (1.06:1), so Hell takes border.subtle (≈ 1.2:1 on the canvas and on white cards).
    backgroundColor: t.colorScheme === 'light' ? t.color.border.subtle : t.color.bg.overlay,
    borderRadius: t.radius.xs,
    flexDirection: 'row',
    gap: t.space[4],
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  onPhoto: { backgroundColor: t.color.onPhoto.chipBg },
  // The 16 check sits in the 20-high badge on the label's centre line; pulling the side keeps the optical padding at 8.
  withGlyph: { paddingLeft: t.space[4] },
}));

/**
 * 09 §5 Badge: height 20, radius 4, `label.badge` 11/14 600 sentence case, surface-3 ground and `text.secondary` label.
 * Verifiziert leads with the check glyph. The label is plain text, so screen readers read it where it stands; a pressable
 * card that names itself adds it to its own label (`VehicleCard` does).
 */
export function Badge({ kind, tone = 'default', style, testID }: BadgeProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const onPhoto = tone === 'onPhoto';
  const colour = onPhoto ? 'onPhoto.primary' : 'text.secondary';
  return (
    <View style={[styles.badge, onPhoto ? styles.onPhoto : null, kind === 'verified' ? styles.withGlyph : null, style]} testID={testID}>
      {kind === 'verified' ? <Icon name="check" size={16} color={colour} /> : null}
      <Text variant="labelBadge" color={colour} hyphenate={false} numberOfLines={1}>
        {t(LABEL_KEY[kind])}
      </Text>
    </View>
  );
}

/** The flags every sample-aware API resource carries (09 §8.19): `is_sample`, and `is_editorial` on members. */
export type SampleFlags = { is_sample?: boolean | null; is_editorial?: boolean | null };

/** The badges a sample-aware item shows, in reading order: Editorial, then Beispiel. Empty for real content. */
export function sampleBadgeKinds(flags: SampleFlags | null | undefined): ('editorial' | 'sample')[] {
  if (!flags) return [];
  return [...(flags.is_editorial ? (['editorial'] as const) : []), ...(flags.is_sample ? (['sample'] as const) : [])];
}

export type SampleBadgesProps = {
  flags: SampleFlags | null | undefined;
  tone?: BadgeProps['tone'];
  style?: StyleProp<ViewStyle>;
  /** `.editorial` and `.sample` are added for the badges. */
  testID?: string;
};

const useRowStyles = createStyles((t) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[4] },
}));

/** "Editorial" and/or "Beispiel" from an API item's flags; nothing for real content. */
export function SampleBadges({ flags, tone, style, testID }: SampleBadgesProps) {
  const styles = useRowStyles();
  const kinds = sampleBadgeKinds(flags);
  if (kinds.length === 0) return null;
  return (
    <View style={[styles.row, style]} testID={testID}>
      {kinds.map((kind) => (
        <Badge key={kind} kind={kind} tone={tone} testID={testID ? `${testID}.${kind}` : undefined} />
      ))}
    </View>
  );
}

/** The "Beispiel" badge (09 §8.19), mandatory on every sample item. */
export function SampleBadge(props: Omit<BadgeProps, 'kind'>) {
  return <Badge kind="sample" {...props} />;
}

/** The "Editorial" badge of the SPEED CLUB Editorial account (09 §8.19). */
export function EditorialBadge(props: Omit<BadgeProps, 'kind'>) {
  return <Badge kind="editorial" {...props} />;
}

/** The badge labels for an accessible name composed elsewhere (a pressable card's label). */
export function useSampleBadgeLabels(flags: SampleFlags | null | undefined): string[] {
  const { t } = useTranslation('common');
  return sampleBadgeKinds(flags).map((kind) => t(LABEL_KEY[kind]));
}
