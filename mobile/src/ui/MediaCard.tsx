import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { createStyles, ThemeScope, typography, useBreakpoint, useTheme, type ThemeName } from '@/theme';

import { Avatar } from './Avatar';
import { SampleBadges, useSampleBadgeLabels, type SampleFlags } from './Badge';
import { Chip } from './Chip';
import { DisplayTitle } from './DisplayTitle';
import { IconButton } from './IconButton';
import { Icon, type IconName } from './icons/Icon';
import { leadAspect, leadBodyGap, leadOverlapShare, MEDIA_ASPECT, pageAt } from './mediaCardLayout';
import { SaveToggle } from './motion/FollowMorph';
import { PageIndicator } from './motion/Pager';
import { ReactionPicker, type ReactionPickerProps } from './motion/ReactionPicker';
import { Photo, ratioOf, type PhotoFields } from './Photo';
import { PhotoStageScrim, PhotoTopScrim } from './PhotoStageScrim';
import { PressableScale } from './PressableScale';
import { joinLabel, useStacksAtFontScale } from './rowParts';
import { SkeletonBlock, SkeletonText } from './Skeleton';
import { Text } from './Text';
import { metaLineText, vehicleNameText } from './textBreaks';

/** What every variant knows about the build it shows. */
type MediaCardBase = {
  /** The car's name: "Nissan Skyline GT-R R34" (display.title on the lead, headline elsewhere). */
  title: string;
  /** API flags (09 §8.19): "Beispiel" / "Editorial" on sample content, on the photo. */
  sample?: SampleFlags;
  /** Opens the build (VEH-01). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Sub-testIDs: `.photo`, `.title`, `.sample`, `.save`, `.share`, `.more`, `.page.<n>`. */
  testID?: string;
};

export type MediaCardOwner = { username: string; avatarUri?: string | null; avatarBlurhash?: string | null };

export type MediaCardSave = { saved: boolean; onToggle: () => void };

export type MediaCardLeadProps = MediaCardBase & {
  variant: 'lead';
  photo: PhotoFields;
  /** "510 PS · 650 Nm · 3,9 s": one quiet line under the name. */
  spec?: string;
  owner?: MediaCardOwner;
  save?: MediaCardSave;
  /** The card's width when the parent knows it before layout (the screen's width for a full-bleed lead). */
  layoutWidth?: number;
  /** 16:9 at every width (09 §7.3 "Build der Woche"); the page lead is 4:5 on phones and tablets. */
  wide?: boolean;
};

export type MediaCardFeedProps = MediaCardBase & {
  variant: 'feed';
  /** One or more photos, edge to edge; more than one become a pager with the page pill. */
  photos: readonly (PhotoFields & { alt?: string })[];
  /** 4:5 (default) or 1:1. */
  square?: boolean;
  /** The vehicle's avatar (its cover) in the header. */
  vehicleAvatar?: { uri?: string | null; blurhash?: string | null };
  /** None when the owner hides themselves on their builds (ADR-148 a): the header names nobody. */
  owner?: MediaCardOwner;
  /**
   * Opens the owner's profile (PROF-02). The owner then leaves the header (car name and time) for a row of their own under the photo,
   * a link with their avatar, above their caption: the car is the subject on top, the person speaks under it.
   */
  onOwnerPress?: () => void;
  /** "vor 2 Std." */
  time: string;
  /** The update's text: three lines, then "mehr". */
  caption?: string;
  /** Linked mods: chips that open VEH-02, each with its system's auto glyph (`categoryIcon`; 09 §4.5, DQ-956), else `part-box`. */
  mods?: readonly { key: string; label: string; icon?: IconName; onPress: () => void }[];
  /** SM9 reaction button (counts are never shown here). */
  reaction?: Omit<ReactionPickerProps, 'testID'>;
  save?: MediaCardSave;
  onShare?: () => void;
};

export type MediaCardRailProps = MediaCardBase & {
  variant: 'rail';
  photo: PhotoFields;
  /** "510 PS · AWD" */
  spec?: string;
};

export type MediaCardWallProps = MediaCardBase & {
  variant: 'wall';
  photo: PhotoFields;
  /** 1:1 (default) or 4:5. */
  tall?: boolean;
};

export type MediaCardProps = MediaCardLeadProps | MediaCardFeedProps | MediaCardRailProps | MediaCardWallProps;

const CAPTION_LINES = 3;
const RAIL_TITLE_LINES = 2;

const useStyles = createStyles((t) => ({
  hover: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.hover },
  badgesTopLeft: { left: t.space[12], position: 'absolute', top: t.space[12] },
  // lead
  lead: { backgroundColor: t.color.scrim.photoEnd },
  leadSave: { position: 'absolute', right: t.space[4], top: t.space[4] },
  leadIdentity: { gap: t.space[8], paddingBottom: t.space[24] },
  leadMeta: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  leadMetaText: { flexShrink: 1 },
  // feed
  feed: { gap: t.space[12] },
  feedHeader: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.touchMin },
  feedHeaderText: { flex: 1, minWidth: 0 },
  vehicleGlyph: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    height: t.size.avatar.sm,
    justifyContent: 'center',
    width: t.size.avatar.sm,
  },
  // A wrapped header keeps the avatar on its first line.
  feedHeaderTop: { alignItems: 'flex-start' },
  feedPages: { alignItems: 'center' },
  feedBody: { gap: t.space[8] },
  ownerLink: { alignSelf: 'flex-start', maxWidth: '100%' },
  ownerRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], minHeight: t.size.touchMin },
  ownerName: { flexShrink: 1 },
  feedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  feedActions: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], paddingHorizontal: t.space[8] },
  more: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: t.size.touchMin },
  probe: { left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
  // rail
  railVisual: { borderRadius: t.radius.md },
  railText: { gap: t.space[2], marginTop: t.space[8] },
  // wall
  // One caption line in the scrim's darkest band, below the text-safe line of a 1:1 tile from 160 wide (24 of 180 is 13 %).
  wallText: { bottom: 0, left: 0, paddingBottom: t.space[8], paddingHorizontal: t.space[8], position: 'absolute', right: 0 },
  wallBelow: { marginTop: t.space[8] },
}));

/**
 * 09 §5 MediaCard, photo first, no shadows and no borders:
 * - `lead`: full width, 4:5, 0 radius, `scrim.photo` into the dark stage, the name in `display.title`, owner chip and one spec
 *   line on the stage (text only below the scrim's safe lines, ADR-421 b), save over `scrim.top`;
 * - `feed`: header (vehicle avatar 32, name, @owner · time), media edge to edge (4:5 or 1:1) with the page pill, caption three
 *   lines + "mehr", linked mod chips, action row reaction · save · share without public counts;
 * - `rail`: 3:4 radius 12, name `headline` on two lines below, spec caption;
 * - `wall`: one tile of the 2-column wall (2 apart, 0 radius), name on `scrim.photo`.
 * The thumbhash (or blurhash) shows while a photo loads; Photo gives every image a `recyclingKey` for FlashList cells.
 */
export function MediaCard(props: MediaCardProps) {
  switch (props.variant) {
    case 'lead':
      return <LeadCard {...props} />;
    case 'feed':
      return <FeedCard {...props} />;
    case 'rail':
      return <RailCard {...props} />;
    case 'wall':
      return <WallCard {...props} />;
  }
}

/** The card's pressable shell, or a plain view without `onPress`. Web reads the content; native gets one name. */
function Shell({
  onPress,
  label,
  style,
  contentStyle,
  testID,
  children,
}: {
  onPress?: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
  children: (hovered: boolean) => ReactNode;
}) {
  if (!onPress) {
    return (
      <View style={[style, contentStyle]} testID={testID}>
        {children(false)}
      </View>
    );
  }
  return (
    <PressableScale role="link" aria-label={isWeb ? undefined : label} onPress={onPress} style={style} contentStyle={contentStyle} ring="card" testID={testID}>
      {(state) => children(state.hovered)}
    </PressableScale>
  );
}

function LeadCard({ title, photo, spec, owner, save, sample, onPress, layoutWidth, wide = false, style, testID }: MediaCardLeadProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const { gutter, kind } = useBreakpoint();
  const [width, setWidth] = useState(layoutWidth ?? 0);
  const badges = useSampleBadgeLabels(sample);
  const titleLine = typography.displayTitle.lineHeight * theme.fontScale;
  const ratio = leadAspect(kind === 'desktop' || wide);
  const bodyGap = width > 0 ? leadBodyGap(width, theme.name, titleLine, ratio) : undefined;
  const overlap = `${-leadOverlapShare(theme.name, ratio) * 100}%` as const;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  };

  return (
    <View style={[styles.lead, style]} onLayout={onLayout} testID={testID}>
      <Shell onPress={onPress} label={joinLabel([...badges, title, owner ? `@${owner.username}` : null, spec])} testID={testID ? `${testID}.open` : undefined}>
        {(hovered) => (
          <>
            <Photo {...photo} aspect={ratio} testID={testID ? `${testID}.photo` : undefined}>
              {hovered ? <View style={styles.hover} /> : null}
              <PhotoTopScrim />
              <PhotoStageScrim />
              <SampleBadges flags={sample} tone="onPhoto" style={styles.badgesTopLeft} testID={testID ? `${testID}.sample` : undefined} />
            </Photo>
            <View style={[styles.leadIdentity, { marginTop: overlap, paddingHorizontal: gutter }]}>
              <DisplayTitle placement="card" color="onPhoto.primary" layoutWidth={width > 0 ? width - 2 * gutter : undefined} testID={testID ? `${testID}.title` : undefined}>
                {title}
              </DisplayTitle>
              {owner || spec ? (
                <View style={[styles.leadMeta, bodyGap === undefined ? null : { marginTop: bodyGap - theme.space[8] }]}>
                  {owner ? <Avatar name={owner.username} uri={owner.avatarUri} blurhash={owner.avatarBlurhash} size={32} decorative /> : null}
                  {/* One line: "@lukas.sc · 500 PS · AWD", the owner in callout, the spec in caption. */}
                  <Text variant="callout" color="onPhoto.primary" hyphenate={false} style={styles.leadMetaText}>
                    {owner ? `@${owner.username}` : null}
                    {owner && spec ? ' · ' : null}
                    {spec ? (
                      <Text variant="caption" color="onPhoto.primary" numeric hyphenate={false} testID={testID ? `${testID}.spec` : undefined}>
                        {spec}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </Shell>
      {/* A control of its own over the photo, after the card in the reading order. */}
      {save ? (
        <View style={styles.leadSave}>
          <SaveToggle saved={save.saved} onToggle={save.onToggle} saveLabel={t('actions.save')} tone="onPhoto" testID={testID ? `${testID}.save` : undefined} />
        </View>
      ) : null}
    </View>
  );
}

function FeedCard({ title, photos, square = false, vehicleAvatar, owner, onOwnerPress, time, caption, mods, reaction, save, onShare, sample, onPress, style, testID }: MediaCardFeedProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const ratio = square ? MEDIA_ASPECT.feedSquare : MEDIA_ASPECT.feed;
  const { gutter, width: windowWidth } = useBreakpoint();
  const theme = useTheme();
  // Edge to edge on a phone, the feed column elsewhere; corrected by the first layout.
  const [pageWidth, setPageWidth] = useState(Math.min(windowWidth, theme.layout.feedColumn));
  const [page, setPage] = useState(0);
  const progress = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    if (pageWidth > 0) progress.set(event.contentOffset.x / pageWidth);
  });
  const many = photos.length > 1;
  const largeText = theme.fontScale > 1;
  const ownerLink = owner && onOwnerPress ? owner : null;
  const meta = [owner && !ownerLink ? `@${owner.username}` : null, time].filter(Boolean).join(' · ');

  return (
    <View style={[styles.feed, style]} testID={testID}>
      <Shell
        onPress={onPress}
        label={joinLabel([title, owner ? `@${owner.username}` : null, time])}
        contentStyle={[styles.feedHeader, largeText ? styles.feedHeaderTop : null, { paddingHorizontal: gutter }]}
        testID={testID ? `${testID}.header` : undefined}
      >
        {() => (
          <>
            {/* DQ-971: a vehicle is its cover crop; without one a glyph tile, never a person's initials. */}
            {vehicleAvatar?.uri ? (
              <Avatar name={title} uri={vehicleAvatar.uri} blurhash={vehicleAvatar.blurhash} size={32} decorative />
            ) : (
              <View style={styles.vehicleGlyph} testID={testID ? `${testID}.vehicleGlyph` : undefined}>
                <Icon name="wheel" size={16} color="text.secondary" />
              </View>
            )}
            {/* DQ-948: one line each at 100 %; from a larger font both wrap (the name at its spaces, the meta at its "·"), never cut. */}
            <View style={styles.feedHeaderText}>
              <Text variant="headline" hyphenate={false} numberOfLines={largeText ? undefined : 1} testID={testID ? `${testID}.title` : undefined}>
                {largeText ? vehicleNameText(title) : title}
              </Text>
              <Text variant="caption" color="text.secondary" hyphenate={false} numberOfLines={largeText ? undefined : 1}>
                {largeText ? metaLineText(meta) : meta}
              </Text>
            </View>
          </>
        )}
      </Shell>
      <View onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>
        <Animated.ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={many}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(event) => setPage(pageAt(event.nativeEvent.contentOffset.x, pageWidth, photos.length))}
          testID={testID ? `${testID}.media` : undefined}
        >
          {photos.map((photo, index) => (
            <View key={index} style={{ width: pageWidth }}>
              {/* The photo opens the build as the header does; one name for both (the header's), so the photo is not a second stop. */}
              <Shell onPress={onPress} label={joinLabel([title, owner ? `@${owner.username}` : null, time])} testID={testID ? `${testID}.open.${index}` : undefined}>
                {(hovered) => (
                  <Photo
                    {...photo}
                    aspect={ratio}
                    label={photo.alt ?? (many ? t('a11y.photoCounter', { current: index + 1, total: photos.length }) : undefined)}
                    testID={testID ? `${testID}.page.${index}` : undefined}
                  >
                    {hovered ? <View style={styles.hover} /> : null}
                    {index === 0 ? <SampleBadges flags={sample} tone="onPhoto" style={styles.badgesTopLeft} testID={testID ? `${testID}.sample` : undefined} /> : null}
                  </Photo>
                )}
              </Shell>
            </View>
          ))}
        </Animated.ScrollView>
      </View>
      {many ? (
        <View style={styles.feedPages}>
          <PageIndicator progress={progress} count={photos.length} label={t('a11y.photoCounter', { current: page + 1, total: photos.length })} testID={testID ? `${testID}.pages` : undefined} />
        </View>
      ) : null}
      {ownerLink || caption || (mods && mods.length > 0) ? (
        <View style={[styles.feedBody, { paddingHorizontal: gutter }]}>
          {ownerLink && onOwnerPress ? (
            <PressableScale
              role="link"
              // The visible handle is the whole name (WCAG 2.5.3 label in name); the link role says it opens the profile.
              aria-label={isWeb ? undefined : `@${ownerLink.username}`}
              onPress={onOwnerPress}
              style={styles.ownerLink}
              contentStyle={styles.ownerRow}
              testID={testID ? `${testID}.owner` : undefined}
            >
              <Avatar name={ownerLink.username} uri={ownerLink.avatarUri} blurhash={ownerLink.avatarBlurhash} size={32} decorative />
              <Text variant="calloutStrong" hyphenate={false} numberOfLines={1} style={styles.ownerName}>
                {`@${ownerLink.username}`}
              </Text>
            </PressableScale>
          ) : null}
          {caption ? <ClampedCaption text={caption} testID={testID} /> : null}
          {mods && mods.length > 0 ? (
            <View style={styles.feedChips}>
              {mods.map((mod) => (
                <Chip key={mod.key} label={mod.label} icon={mod.icon ?? 'part-box'} onPress={mod.onPress} testID={testID ? `${testID}.mod.${mod.key}` : undefined} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {reaction || save || onShare ? (
        <View style={styles.feedActions}>
          {reaction ? <ReactionPicker {...reaction} testID={testID ? `${testID}.reaction` : 'reaction'} /> : null}
          {save ? <SaveToggle saved={save.saved} onToggle={save.onToggle} saveLabel={t('actions.save')} testID={testID ? `${testID}.save` : undefined} /> : null}
          {onShare ? <IconButton icon="share-network" label={t('actions.share')} onPress={onShare} testID={testID ? `${testID}.share` : undefined} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Three lines, then "mehr" (09 §5 feed caption). A hidden full copy at the same width tells whether the clamp hides text. */
function ClampedCaption({ text, testID }: { text: string; testID?: string }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(0);
  const [full, setFull] = useState(0);
  const overflows = full > clamped + 1;
  return (
    <View>
      <View>
        <Text
          variant="body"
          numberOfLines={expanded ? undefined : CAPTION_LINES}
          onLayout={(event) => {
            if (!expanded) setClamped(event.nativeEvent.layout.height);
          }}
          testID={testID ? `${testID}.caption` : undefined}
        >
          {text}
        </Text>
        {expanded ? null : (
          <Text variant="body" aria-hidden style={styles.probe} onLayout={(event) => setFull(event.nativeEvent.layout.height)}>
            {text}
          </Text>
        )}
      </View>
      {overflows && !expanded ? (
        <PressableScale role="button" aria-expanded={false} onPress={() => setExpanded(true)} style={styles.more} testID={testID ? `${testID}.more` : undefined}>
          <Text variant="bodyStrong" color="text.secondary" selectable={false}>
            {t('mediaCard.more')}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function RailCard({ title, photo, spec, sample, onPress, style, testID }: MediaCardRailProps) {
  const styles = useStyles();
  const largeFont = useStacksAtFontScale();
  const badges = useSampleBadgeLabels(sample);
  return (
    <Shell onPress={onPress} label={joinLabel([...badges, title, spec])} style={style} contentStyle={styles.railVisual} testID={testID}>
      {(hovered) => (
        <>
          <Photo {...photo} aspect={MEDIA_ASPECT.rail} corner="md" testID={testID ? `${testID}.photo` : undefined}>
            {hovered ? <View style={styles.hover} /> : null}
            <SampleBadges flags={sample} tone="onPhoto" style={styles.badgesTopLeft} testID={testID ? `${testID}.sample` : undefined} />
          </Photo>
          <View style={styles.railText}>
            {/* ADR-128: make and model are never cut at a large font. */}
            <Text variant="headline" hyphenate={largeFont} numberOfLines={largeFont ? undefined : RAIL_TITLE_LINES} testID={testID ? `${testID}.title` : undefined}>
              {title}
            </Text>
            {spec ? (
              <Text variant="caption" color="text.secondary" numeric hyphenate={false}>
                {spec}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </Shell>
  );
}

function WallCard({ title, photo, tall = false, sample, onPress, style, testID }: MediaCardWallProps) {
  const styles = useStyles();
  // ADR-128 / ADR-426 d: a car name is never cut. At a large font it leaves the photo and sits under it in page colours.
  const largeFont = useStacksAtFontScale();
  const badges = useSampleBadgeLabels(sample);
  return (
    <Shell onPress={onPress} label={joinLabel([...badges, title])} style={style} testID={testID}>
      {(hovered) => (
        <>
          <Photo {...photo} aspect={tall ? MEDIA_ASPECT.wallTall : MEDIA_ASPECT.wall} testID={testID ? `${testID}.photo` : undefined}>
            {hovered ? <View style={styles.hover} /> : null}
            {largeFont ? null : <PhotoStageScrim />}
            <SampleBadges flags={sample} tone="onPhoto" style={styles.badgesTopLeft} testID={testID ? `${testID}.sample` : undefined} />
            {largeFont ? null : (
              <View style={styles.wallText}>
                <Text variant="caption" color="onPhoto.primary" numberOfLines={1} hyphenate={false} testID={testID ? `${testID}.title` : undefined}>
                  {title}
                </Text>
              </View>
            )}
          </Photo>
          {largeFont ? (
            <Text variant="caption" style={styles.wallBelow} testID={testID ? `${testID}.title` : undefined}>
              {title}
            </Text>
          ) : null}
        </>
      )}
    </Shell>
  );
}

/**
 * SM15: the loading state of each variant, the same geometry (photo box at its ratio and radius, text lines at their line
 * heights) as the loaded card.
 */
/** The stage under every photo is dark in every theme (ADR-421 b): its skeleton bars take a dark theme's tones. */
const STAGE_THEME: ThemeName = 'carbon';

export type MediaCardSkeletonProps = {
  variant: MediaCardProps['variant'];
  /** `lead`: the name's lines (1 at 100 %; 2 from a large font, DQ-983). `feed`: the caption's lines under the photo (DQ-984). */
  lines?: number;
  /** `feed`: the action row under the caption (DQ-984). */
  actions?: boolean;
  /** `feed`: the card has no header row (the parent draws its own). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function MediaCardSkeleton({ variant, lines, actions = false, style, testID }: MediaCardSkeletonProps) {
  const styles = useSkeletonStyles();
  const theme = useTheme();
  const { gutter, kind } = useBreakpoint();
  if (variant === 'rail') {
    return (
      <View style={style} testID={testID}>
        <SkeletonBlock aspectRatio={ratioOf(MEDIA_ASPECT.rail)} corner="md" />
        <View style={styles.railText}>
          <SkeletonText variant="headline" width="80%" />
          <SkeletonText variant="caption" width="50%" />
        </View>
      </View>
    );
  }
  if (variant === 'wall') {
    return <SkeletonBlock aspectRatio={ratioOf(MEDIA_ASPECT.wall)} corner="none" style={[styles.stage, style]} testID={testID} />;
  }
  if (variant === 'lead') {
    // DQ-980: the loaded lead is its photo, with the name on the scrim inside it. So is the skeleton: the stage block of the lead's
    // aspect (every theme, ADR-421 b), the bars in the stage's tones. DQ-983: the bars are the loaded identity block, with its line
    // heights at the font scale and the same overlap into the photo, so a 2-line name at 200 % grows the skeleton as it grows the card.
    const ratio = leadAspect(kind === 'desktop');
    const titleLines = lines ?? (theme.fontScale >= LEAD_TWO_LINE_SCALE ? 2 : 1);
    return (
      <View style={[styles.leadStage, style]} dataSet={{ qaExempt: 'photo' }} testID={testID}>
        <View style={{ aspectRatio: ratioOf(ratio) }} testID={testID ? `${testID}.photo` : undefined} />
        <ThemeScope name={STAGE_THEME}>
          <View
            style={[styles.leadBars, { marginTop: `${-leadOverlapShare(theme.name, ratio) * 100}%`, paddingHorizontal: gutter }]}
            testID={testID ? `${testID}.identity` : undefined}
          >
            <SkeletonText variant="displayTitle" width="70%" lines={titleLines} lastLineWidth="45%" testID={testID ? `${testID}.title` : undefined} />
            <SkeletonBlock height={Math.max(theme.size.avatar.sm, theme.typography.callout.lineHeight * theme.fontScale)} width="45%" corner="xs" />
          </View>
        </ThemeScope>
      </View>
    );
  }
  // DQ-984: the header, the photo on the dark stage (as every photo, ADR-421 b), the caption lines and the action row.
  return (
    <View style={style} testID={testID}>
      <View style={[styles.feedHeader, { paddingHorizontal: gutter }]}>
        <SkeletonBlock width={theme.size.avatar.sm} height={theme.size.avatar.sm} corner="full" />
        <View style={styles.feedHeaderText}>
          <SkeletonText variant="headline" width="60%" />
          <SkeletonText variant="caption" width="40%" />
        </View>
      </View>
      <SkeletonBlock aspectRatio={ratioOf(MEDIA_ASPECT.feed)} corner="none" style={styles.stage} />
      {lines && lines > 0 ? (
        <View style={[styles.feedCaption, { paddingHorizontal: gutter }]}>
          <SkeletonText variant="body" width="100%" lines={lines} lastLineWidth="60%" />
        </View>
      ) : null}
      {actions ? (
        <View style={[styles.feedActions, { paddingHorizontal: theme.space[8] }]}>
          <SkeletonBlock width={theme.size.touchMin} height={theme.size.touchMin} corner="full" />
          <SkeletonBlock width={theme.size.touchMin} height={theme.size.touchMin} corner="full" />
        </View>
      ) : null}
    </View>
  );
}

/** From this font scale a typical build name ("Nissan Skyline GT-R R34") takes 2 lines of the lead at phone width. */
const LEAD_TWO_LINE_SCALE = 1.3;

const useSkeletonStyles = createStyles((t) => ({
  // The loaded rail card's text: 8 under the photo, 2 between the lines.
  railText: { gap: t.space[2], marginTop: t.space[8] },
  feedHeader: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], marginBottom: t.space[12], minHeight: t.size.touchMin },
  feedHeaderText: { flex: 1, gap: t.space[4] },
  feedCaption: { marginTop: t.space[12] },
  feedActions: { flexDirection: 'row', gap: t.space[4], marginTop: t.space[12] },
  leadBars: { gap: t.space[8], paddingBottom: t.space[24] },
  // The lead's dark stage, as on the loaded card; photo blocks of every variant sit on it.
  leadStage: { backgroundColor: t.color.media.ground, overflow: 'hidden' },
  stage: { backgroundColor: t.color.media.ground },
}));
