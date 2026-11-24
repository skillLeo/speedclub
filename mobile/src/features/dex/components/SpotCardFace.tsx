import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { Rarity, SpotCard, SpotImage } from '@/api/queries/dex';
import { concentric, createStyles, layout } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { Icon } from '@/ui/icons/Icon';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { PhotoStageScrim, PhotoTopScrim } from '@/ui/PhotoStageScrim';
import { Text } from '@/ui/Text';

import { dexNumberText } from '../copy';

/** The card's width: a trading card, 9/16 of the feed column (360), never wider than the window allows. */
export const SPOT_CARD_MAX_WIDTH = (layout.feedColumn * 9) / 16;
/** The card's photo: 4:5, the hero crop of 09 §4.6. */
export const SPOT_CARD_PHOTO = '4:5' as const;

const useStyles = createStyles((t) => ({
  // ADR-421 b: the photo sits on the dark stage in every theme, so the whole card is that stage, with onPhoto text throughout.
  card: { backgroundColor: t.color.scrim.photoEnd, borderRadius: t.radius.xl, overflow: 'hidden' },
  // The Ghost frame: a 2-wide outline and an inner hairline frame, concentric.
  ghost: { borderColor: t.color.onPhoto.border, borderWidth: t.size.border.focusRing },
  ghostInner: {
    borderColor: t.color.onPhoto.border,
    borderRadius: concentric(t.radius.xl, t.space[4]),
    borderWidth: t.size.border.control,
    bottom: t.space[4],
    left: t.space[4],
    pointerEvents: 'none',
    position: 'absolute',
    right: t.space[4],
    top: t.space[4],
  },
  foilInner: { borderColor: t.color.onPhoto.primary },
  topRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: t.space[16],
    position: 'absolute',
    right: t.space[16],
    top: t.space[16],
  },
  tag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    flexDirection: 'row',
    gap: t.space[4],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  body: { gap: t.space[12], padding: t.layout.cardPadding },
  mods: { gap: t.space[4] },
  footer: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'space-between' },
  owner: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: t.space[8] },
  tags: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: t.space[8] },
  back: {
    alignItems: 'center',
    backgroundColor: t.color.media.ground,
    borderColor: t.color.onPhoto.border,
    borderRadius: t.radius.xl,
    borderWidth: t.size.border.control,
    flex: 1,
    gap: t.space[16],
    justifyContent: 'center',
  },
}));

/** The car's tier as words; Ghost wins (contract §5). */
export function rarityOf(card: Pick<SpotCard['vehicle'], 'rarity' | 'ghost'>): Rarity {
  return card.ghost ? 'ghost' : (card.rarity ?? 'street');
}

/** A tag on the photo or the stage: label.badge on the photo chip ground (ADR-421 b). */
export function CardTag({ label, accessibilityLabel, testID }: { label: string; accessibilityLabel?: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tag} accessible={accessibilityLabel !== undefined} aria-label={accessibilityLabel} testID={testID}>
      <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The cover as the photo takes it: the thumbhash when the media has one, else the blurhash (member uploads carry only a blurhash,
 * API handover "Deviations" 1). The card's cover is the widest variant up to 1080 px.
 */
export function coverPhoto(cover: SpotImage | null): PhotoFields {
  return { source: cover?.url ?? null, thumbhash: cover?.thumbhash ?? null, blurhash: cover?.blurhash ?? null };
}

/**
 * One mod line: the brand before the title, unless the title already starts with it. The server sends the mod's own title, which
 * members usually write with the brand ("KW V3", brand "KW"); the live API showed "KW KW V3" before (M5.9b reconciliation).
 */
export function modLine(mod: SpotCard['vehicle']['top_mods'][number]): string {
  const name = mod.name.trim();
  const brand = mod.brand?.trim();
  if (!brand || name.toLocaleLowerCase('de').startsWith(brand.toLocaleLowerCase('de'))) return name;
  return `${brand} ${name}`;
}

export type SpotCardFaceProps = {
  card: SpotCard;
  width: number;
  /** Shows the First Spotter tag in the top row and the static foil rule (the sweep itself is the reveal's FoilShine). */
  firstSpotter: boolean;
  /** A sample of the "only in the app" state: badged "Beispiel". */
  sampleLabel?: string;
  /** A bundled photo in place of the cover (the sample's licensed seed photo). */
  photo?: PhotoFields;
  /** False for a car not spotted yet (DEX-04 preview): its "Noch nicht gespottet" tag stands in for the rarity. */
  showRarity?: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * DEX-03/DEX-04 card front (09 §4: photography is the interface): the cover at 4:5 into the dark stage with only the tags on
 * its top scrim (Beispiel, First Spotter, rarity); on the stage the Dex number as an Archivo numeral, the name in display.title,
 * up to three mods, the owner and the cities line. Cars speak Archivo, people speak Inter.
 */
export function SpotCardFace({ card, width, firstSpotter, sampleLabel, photo, showRarity = true, style, testID }: SpotCardFaceProps) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const { vehicle } = card;
  const tier = rarityOf(vehicle);
  const number = dexNumberText(vehicle.dex_number);
  const owner = vehicle.owner;
  const mods = vehicle.top_mods.slice(0, 3).map(modLine);
  const textWidth = width - 2 * layout.cardPadding;
  return (
    <View style={[styles.card, tier === 'ghost' ? styles.ghost : null, { width }, style]} testID={testID}>
      <Photo
        {...(photo ?? coverPhoto(vehicle.cover))}
        aspect={SPOT_CARD_PHOTO} priority="high" testID={`${testID}.photo`}>
        <PhotoTopScrim />
        <PhotoStageScrim />
        <View style={styles.topRow}>
          {/* DQ-P5G-01: only the tags sit on the photo (they carry their own chip ground); the number lives on the stage below. */}
          <View style={styles.tags}>
            {sampleLabel ? <CardTag label={sampleLabel} testID={`${testID}.sample`} /> : null}
            {firstSpotter ? <CardTag label={t('reveal.firstSpotter')} testID={`${testID}.firstSpotter`} /> : null}
          </View>
          {showRarity ? (
            <CardTag
              label={t(`rarity.${tier}`)}
              accessibilityLabel={t('rarity.label', { tier: t(`rarity.${tier}`) })}
              testID={`${testID}.rarity.${tier}`}
            />
          ) : null}
        </View>
      </Photo>
      <View style={styles.body}>
        {number ? (
          <View accessible aria-label={t('reveal.dexNumberLabel', { number })} testID={`${testID}.number`}>
            <Text variant="heroNumeralS" color="onPhoto.primary" hyphenate={false}>
              {t('reveal.dexNumber', { number })}
            </Text>
          </View>
        ) : null}
        <DisplayTitle placement="card" color="onPhoto.primary" layoutWidth={textWidth > 0 ? textWidth : undefined} testID={`${testID}.name`}>
          {vehicle.name}
        </DisplayTitle>
        {mods.length > 0 ? (
          <View style={styles.mods} testID={`${testID}.mods`}>
            {mods.map((mod) => (
              <Text key={mod} variant="callout" color="onPhoto.secondary" numberOfLines={1}>
                {mod}
              </Text>
            ))}
          </View>
        ) : null}
        {owner || card.cities_count_label ? (
          <View style={styles.footer}>
            {owner ? (
              <View style={styles.owner} accessible aria-label={t('reveal.ownerLabel', { name: owner.display_name || `@${owner.username}` })} testID={`${testID}.owner`}>
                <Avatar name={owner.display_name || owner.username} uri={owner.avatar?.url ?? null} size={24} decorative />
                <Text variant="callout" color="onPhoto.primary" hyphenate={false} numberOfLines={1}>
                  {t('reveal.byOwner', { username: owner.username })}
                </Text>
              </View>
            ) : null}
            {card.cities_count_label ? (
              <Text variant="callout" color="onPhoto.secondary" numeric testID={`${testID}.cities`}>
                {card.cities_count_label}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {/* DQ-P5G-14: the permanent First Spotter foil at rest is a 1-wide light rule inside the card (FoilShine is the one-time sweep). */}
      {/* A Ghost First Spotter keeps one inner frame, in the foil's light. */}
      {firstSpotter || tier === 'ghost' ? (
        <View
          style={[styles.ghostInner, firstSpotter ? styles.foilInner : null]}
          testID={`${testID}.${tier === 'ghost' ? 'ghostFrame' : 'foilFrame'}`}
        />
      ) : null}
    </View>
  );
}

/** The card's back before the flip: the sticker glyph and the wordmark on the dark stage (a brand moment). It fills the front's box. */
export function SpotCardBack({ width, testID }: { width: number; testID: string }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  return (
    <View style={[styles.back, { width }]} aria-label={t('reveal.cardBack')} testID={testID}>
      <Icon name="qr-sticker" size={48} color="onPhoto.primary" />
      <AppWordmark width={width / 2} tone="white" decorative />
    </View>
  );
}
