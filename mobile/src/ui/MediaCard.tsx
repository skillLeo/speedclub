import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { aspect, createStyles, size, ThemeScope, typography, useBreakpoint, useTheme, type ThemeName } from '@/theme';

import { Avatar } from './Avatar';
import { SampleBadges, useSampleBadgeLabels, type SampleFlags } from './Badge';
import { Chip } from './Chip';
import { DisplayTitle } from './DisplayTitle';
import { IconButton } from './IconButton';
import { Icon, type IconName } from './icons/Icon';
import { leadAspect, leadBodyGap, leadOverlapShare, MEDIA_ASPECT, pageAt, wallTitleBand } from './mediaCardLayout';
import { SaveToggle } from './motion/FollowMorph';
import { PageIndicator } from './motion/Pager';
import { ReactionPicker, type ReactionPickerProps } from './motion/ReactionPicker';
import { Photo, ratioOf, type PhotoFields } from './Photo';
import { PhotoStageScrim, PhotoTopScrim } from './PhotoStageScrim';
import { PressableScale } from './PressableScale';
import { joinLabel, useStacksAtFontScale } from './rowParts';
import { SkeletonBlock, SkeletonText } from './Skeleton';
import { Text } from './Text';
import { keepModelLettersTogether, metaLineText, vehicleNameText } from './textBreaks';

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

export type MediaCardComment = { label: string; onPress: () => void };

export type MediaCardLeadProps = MediaCardBase & {
  variant: 'lead';
  photo: PhotoFields;
  /** "510 PS · 650 Nm · 3,9 s": one quiet line under the name. */
  spec?: string;
  owner?: MediaCardOwner;
  /** The card's width when the parent knows it before layout (the screen's width for a full-bleed lead). */
  layoutWidth?: number;
  /** 16:9 at every width (09 §7.3 "Build der Woche"); the page lead is 4:5 on phones and tablets. */
  wide?: boolean;
  /**
   * A page hero from 1280: `aspect.heroDesktop` (21:9, client feedback CF-1, ADR-521), as VEH-01 and WEB-01, so the page under it
   * starts above the fold (SHOP-01, DQ-P5-006). Phones and tablets keep the lead's own crop.
   */
  cinema?: boolean;
  /** The first screen's hero: its photo loads first (Photo `priority`). */
  priority?: 'high';
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
  /** R4-2.2 "Kommentare": opens the item's comments (a sheet); never a count. */
  comment?: MediaCardComment;
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
/** A text box taller than this many lines has wrapped (its height is a whole number of lines). */
const WRAPPED_AT_LINES = 1.5;

const useStyles = createStyles((t) => ({
  hover: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.hover },
  badgesTopLeft: { left: t.space[12], position: 'absolute', top: t.space[12] },
  // lead
  lead: { backgroundColor: t.color.scrim.photoEnd },
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
  feedActionRow: { flexDirection: 'row' },
  feedActions: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  // A 44 target at least in both directions: "mehr" is narrower than that (DEV-01 m4.18: 37.5 wide).
  more: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: t.size.touchMin, minWidth: t.size.touchMin },
  probe: { left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
  // rail
  railVisual: { borderRadius: t.radius.md },
  railText: { gap: t.space[2], marginTop: t.space[8] },
  // wall
  // The name in the scrim's darkest band, below the text-safe line: one line, or two where the tile is tall enough (DQ-1156).
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

/**
 * The lead has no save of its own (M4.18): a save over the photo lies inside the card's open target, two targets on one spot (the
 * DOM audit's `overlap`, M4.8 r2). Save and share go in an action row under the card, as HomeLead and the gallery show it.
 */
function LeadCard({ title, photo, spec, owner, sample, onPress, layoutWidth, wide = false, cinema = false, priority, style, testID }: MediaCardLeadProps) {
  const styles = useStyles();
  const theme = useTheme();
  const { gutter, kind } = useBreakpoint();
  const [width, setWidth] = useState(layoutWidth ?? 0);
  const badges = useSampleBadgeLabels(sample);
  const titleLine = typography.displayTitle.lineHeight * theme.fontScale;
  const ratio = cinema && kind === 'desktop' ? aspect.heroDesktop : leadAspect(kind === 'desktop' || wide);
  const bodyGap = width > 0 ? leadBodyGap(width, theme.name, titleLine, ratio) : undefined;
  const share = leadOverlapShare(theme.name, ratio);
  const overlap = `${-share * 100}%` as const;
  // DQ-P5-001: the identity rises into the photo by `share` of the width; a short one (a name without a line under it) must still
  // reach the photo's foot, or what follows the card (SHOP-01's chips on desktop) is drawn on the photo's stage.
  const identityFloor = width > 0 ? { minHeight: Math.ceil(width * share) } : null;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  };

  return (
    <View style={[styles.lead, style]} onLayout={onLayout} testID={testID}>
      <Shell onPress={onPress} label={joinLabel([...badges, title, owner ? `@${owner.username}` : null, spec])} testID={testID ? `${testID}.open` : undefined}>
        {(hovered) => (
          <>
            <Photo {...photo} aspect={ratio} priority={priority} testID={testID ? `${testID}.photo` : undefined}>
              {hovered ? <View style={styles.hover} /> : null}
              <PhotoTopScrim />
              <PhotoStageScrim />
              <SampleBadges flags={sample} tone="onPhoto" style={styles.badgesTopLeft} testID={testID ? `${testID}.sample` : undefined} />
            </Photo>
            <View style={[styles.leadIdentity, { marginTop: overlap, paddingHorizontal: gutter }, identityFloor]}>
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
    </View>
  );
}

/**
 * R4DQ-37: the action row's inset, so the first glyph (24, centred in its 44 target) starts on the gutter, the left edge of the
 * header's avatar, the caption and the chips above it.
 */
export function feedActionInset(gutter: number): number {
  return Math.max(0, gutter - (size.touchMin - size.icon.l) / 2);
}

function FeedCard({
  title,
  photos,
  square = false,
  vehicleAvatar,
  owner,
  onOwnerPress,
  time,
  caption,
  mods,
  reaction,
  comment,
  save,
  onShare,
  sample,
  onPress,
  style,
  testID,
}: MediaCardFeedProps) {
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
        {/* R5-4: one photo is no pager. A ScrollView with scrolling off is `touch-action: none` on the web (react-native-web), so a
            finger that landed on a single-photo card could not scroll the feed on a phone. */}
        <FeedPager
          many={many}
          onScroll={onScroll}
          onPageEnd={(x) => setPage(pageAt(x, pageWidth, photos.length))}
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
        </FeedPager>
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
      {reaction || comment || save || onShare ? (
        <View style={styles.feedActionRow} testID={testID ? `${testID}.actions` : undefined}>
          {/* A spacer, not a padding: the inset (gutter − 10) is off the spacing scale by design. */}
          <View style={{ width: feedActionInset(gutter) }} />
          <View style={styles.feedActions}>
            {reaction ? <ReactionPicker {...reaction} testID={testID ? `${testID}.reaction` : 'reaction'} /> : null}
            {comment ? <IconButton icon="chat-circle" label={comment.label} onPress={comment.onPress} testID={testID ? `${testID}.comment` : undefined} /> : null}
            {save ? <SaveToggle saved={save.saved} onToggle={save.onToggle} saveLabel={t('actions.save')} testID={testID ? `${testID}.save` : undefined} /> : null}
            {onShare ? <IconButton icon="share-network" label={t('actions.share')} onPress={onShare} testID={testID ? `${testID}.share` : undefined} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Three lines, then "mehr" (09 §5 feed caption). A hidden full copy at the same width tells whether the clamp hides text. */
type FeedPagerProps = {
  many: boolean;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  onPageEnd: (offsetX: number) => void;
  testID?: string;
  children: ReactNode;
};

/**
 * The feed card's photos: a paging ScrollView only when there are two or more. A single photo is a plain box, because a ScrollView with
 * `scrollEnabled={false}` is `touch-action: none` on the web (react-native-web ScrollViewBase), which held the feed still on a phone
 * whenever a vertical swipe began on the photo (R5-4).
 */
function FeedPager({ many, onScroll, onPageEnd, testID, children }: FeedPagerProps) {
  if (!many) return <View testID={testID}>{children}</View>;
  return (
    <Animated.ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={(event) => onPageEnd(event.nativeEvent.contentOffset.x)}
      testID={testID}
    >
      {children}
    </Animated.ScrollView>
  );
}

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
  const theme = useTheme();
  // ADR-128 / ADR-426 d: a car name is never cut. At a large font it leaves the photo and sits under it in page colours.
  const largeFont = useStacksAtFontScale();
  const badges = useSampleBadgeLabels(sample);
  // DQ-1156: a second line on the scrim where it stays below the text-safe line; the tile's width comes from the name's band.
  const line = typography.caption.lineHeight * theme.fontScale;
  const [tileWidth, setTileWidth] = useState(0);
  const [wrapped, setWrapped] = useState(false);
  const band = wallTitleBand(tileWidth, theme.name, line, tall ? MEDIA_ASPECT.wallTall : MEDIA_ASPECT.wall);
  const twoLines = band.lines === 2;
  return (
    <Shell onPress={onPress} label={joinLabel([...badges, title])} style={style} testID={testID}>
      {(hovered) => (
        <>
          <Photo {...photo} aspect={tall ? MEDIA_ASPECT.wallTall : MEDIA_ASPECT.wall} testID={testID ? `${testID}.photo` : undefined}>
            {hovered ? <View style={styles.hover} /> : null}
            {largeFont ? null : <PhotoStageScrim />}
            <SampleBadges flags={sample} tone="onPhoto" style={styles.badgesTopLeft} testID={testID ? `${testID}.sample` : undefined} />
            {largeFont ? null : (
              <View
                style={[styles.wallText, twoLines && wrapped ? { paddingBottom: band.twoLinePadding } : null]}
                onLayout={(event) => {
                  const next = event.nativeEvent.layout.width;
                  setTileWidth((current) => (current === next ? current : next));
                }}
                testID={testID ? `${testID}.titleBand` : undefined}
              >
                <Text
                  variant="caption"
                  color="onPhoto.primary"
                  numberOfLines={band.lines}
                  hyphenate={false}
                  onLayout={(event) => {
                    const next = twoLines && event.nativeEvent.layout.height > line * WRAPPED_AT_LINES;
                    setWrapped((current) => (current === next ? current : next));
                  }}
                  testID={testID ? `${testID}.title` : undefined}
                >
                  {twoLines ? keepModelLettersTogether(title) : title}
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
  /** `lead`: the 16:9 crop below the desktop too, as the loaded card's `wide`. */
  wide?: boolean;
  /** `lead`: 21:9 from 1280, as the loaded card's `cinema`. */
  cinema?: boolean;
  /**
   * `lead`: the loaded card has an owner (avatar 32 beside the line). False for a lead with only a line under its name (SHOP-01's
   * hero): the line is a callout line, 12 lower than the avatar (DQ-P5-008).
   */
  owner?: boolean;
  /** `feed`: the card has no header row (the parent draws its own). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function MediaCardSkeleton({ variant, lines, actions = false, wide = false, cinema = false, owner = true, style, testID }: MediaCardSkeletonProps) {
  const styles = useSkeletonStyles();
  const theme = useTheme();
  const { gutter, kind } = useBreakpoint();
  const [stageWidth, setStageWidth] = useState(0);
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
    const ratio = cinema && kind === 'desktop' ? aspect.heroDesktop : leadAspect(kind === 'desktop' || wide);
    const titleLines = lines ?? (theme.fontScale >= LEAD_TWO_LINE_SCALE ? 2 : 1);
    const share = leadOverlapShare(theme.name, ratio);
    // The loaded card's identity floor (DQ-P5-001), so the skeleton ends where the card ends.
    const identityFloor = stageWidth > 0 ? { minHeight: Math.ceil(stageWidth * share) } : null;
    return (
      <View
        style={[styles.leadStage, style]}
        onLayout={(event) => setStageWidth(event.nativeEvent.layout.width)}
        dataSet={{ qaExempt: 'photo' }}
        testID={testID}
      >
        <View style={{ aspectRatio: ratioOf(ratio) }} testID={testID ? `${testID}.photo` : undefined} />
        <ThemeScope name={STAGE_THEME}>
          <View
            style={[styles.leadBars, { marginTop: `${-share * 100}%`, paddingHorizontal: gutter }, identityFloor]}
            testID={testID ? `${testID}.identity` : undefined}
          >
            <SkeletonText variant="displayTitle" width="70%" lines={titleLines} lastLineWidth="45%" testID={testID ? `${testID}.title` : undefined} />
            <SkeletonBlock
              height={owner ? Math.max(theme.size.avatar.sm, theme.typography.callout.lineHeight * theme.fontScale) : theme.typography.callout.lineHeight * theme.fontScale}
              width="45%"
              corner="xs"
            />
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
        <View style={styles.feedActionRow}>
          <View style={{ width: feedActionInset(gutter) }} />
          <View style={styles.feedActions}>
            <SkeletonBlock width={theme.size.touchMin} height={theme.size.touchMin} corner="full" />
            <SkeletonBlock width={theme.size.touchMin} height={theme.size.touchMin} corner="full" />
          </View>
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
  feedActionRow: { flexDirection: 'row', marginTop: t.space[12] },
  feedActions: { flexDirection: 'row', gap: t.space[4] },
  leadBars: { gap: t.space[8], paddingBottom: t.space[24] },
  // The lead's dark stage, as on the loaded card; photo blocks of every variant sit on it.
  leadStage: { backgroundColor: t.color.media.ground, overflow: 'hidden' },
  stage: { backgroundColor: t.color.media.ground },
}));
