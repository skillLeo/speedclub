import { useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type Animated from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';
import { createStyles, layout as layoutTokens, size, space, typography, useBreakpoint, useTheme, type TypeVariant } from '@/theme';
import { OWNER_IDENTITY_MIN_WIDTH, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { DESKTOP_CARD_FLEX, DESKTOP_GALLERY_FLEX, TABLET_COLUMN, useProfileLayout } from '../layout';
import { keptSubline, PROFILE_TABS } from '../model';
import {
  BLUEPRINT_EYEBROW_EM,
  BLUEPRINT_SUBLINE,
  BLUEPRINT_SUBLINE_PARTS,
  BLUEPRINT_TITLE,
  blueprintLines,
  buttonChrome,
  buttonHeight,
  estimatedLabelWidth,
  wrapWords,
  type ButtonSize,
} from '../skeletonGeometry';
import { thumbLayout, useThumbRowStyles } from './DesktopThumbs';
import { ProfileFrame, useContentWidth, useEstimatedOverlayHeight } from './ProfileFrame';

/** Above this font scale the strip and the owner row stack, as SpecStrip and OwnerRow do. */
const STACK_FONT_SCALE = 1.2;
/**
 * OwnerRow's rule (ADR-170 as amended by DQ-262) for a guest's Folgen and Nachricht: the identity minimum plus the pair's width,
 * 438 with the insets. A member's pair is measured in its widest state, "✓ Folge ich" and Nachricht, as the page lays it out.
 */
const OWNER_INLINE_MIN_WIDTH = 438;
const HERO_RATIO = 4 / 3;
const THUMB_RATIO = 4 / 3;
/** Without a known vehicle: three photos, the hero and two thumbnails on a desktop (FS-10's smallest row). */
const DEFAULT_PHOTO_COUNT = 3;
const ROW_COUNT = 3;

const useStyles = createStyles((t) => ({
  flat: { borderRadius: 0 },
  summary: { paddingTop: t.space[20] },
  title: { marginTop: t.space[4] },
  subline: { marginTop: t.space[4] },
  strip: { marginTop: t.space[16] },
  owner: { gap: t.space[12], marginTop: t.space[16] },
  ownerInline: { alignItems: 'center', flexDirection: 'row' },
  identity: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: t.space[12] },
  // As OwnerRow: name and meta on their own line heights, nothing between them.
  names: { flex: 1 },
  // As OwnerRow's actions and GAR-02's toolbar: buttons that wrap rather than scroll.
  buttons: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  buttonsInline: { flexShrink: 0 },
  toolbar: { marginTop: t.space[16] },
  // Measures the labels on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
  tabs: { marginTop: t.space[24] },
  // ContentTabs: 12 of padding around each label, so 24 between two; it scrolls where this one clips.
  tabRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[24], minHeight: t.size.contentTab, overflow: 'hidden' },
  // As ContentTabs' label (§8 15/20 at 600): bodyDense's size on labelS' line and family.
  tabLabel: {
    fontSize: t.typography.bodyDense.fontSize * (isWeb ? t.fontScale : 1),
    lineHeight: t.typography.labelS.lineHeight * (isWeb ? t.fontScale : 1),
  },
  hairline: { backgroundColor: t.color.border.subtle, height: isWeb ? t.size.border.control : StyleSheet.hairlineWidth },
  panel: { gap: t.space[12], paddingBottom: t.space[32], paddingTop: t.space[24] },
  tabletColumn: { alignSelf: 'center', maxWidth: TABLET_COLUMN, paddingTop: t.space[24], width: '100%' },
  desktopRow: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: t.space[24],
    maxWidth: layoutTokens.contentMax + 2 * t.space[24],
    padding: t.space[24],
    width: '100%',
  },
  desktopGallery: { flex: DESKTOP_GALLERY_FLEX, minWidth: 0 },
  desktopAside: { flex: DESKTOP_CARD_FLEX, minWidth: 0 },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, padding: t.space[24] },
}));

/** FS-3 strip: 16 + value + 2 + label + 16 per row, two rows of two at a large font with a hairline between them. */
function stripHeight(fontScale: number): number {
  const rows = fontScale > STACK_FONT_SCALE ? 2 : 1;
  const row = 2 * space[16] + (typography.specStrip.lineHeight + typography.caption.lineHeight) * fontScale + space[2];
  const hairline = isWeb ? size.border.control : StyleSheet.hairlineWidth;
  return rows * row + (rows - 1) * hairline;
}

/** FS-3's title or sub-line, line by line as the page breaks it (DQ-178). */
function BlueprintText({ lines, variant, style, testID }: { lines: number[]; variant: 'displayL' | 'supporting'; style: StyleProp<ViewStyle>; testID: string }) {
  return (
    <SkeletonText
      variant={variant}
      lines={lines.length}
      width={lines[0]}
      lastLineWidth={lines[lines.length - 1]}
      style={style}
      testID={testID}
    />
  );
}

/**
 * The one-line widths of real labels, measured invisibly in their own type, so blocks drawn for them are as wide as the
 * controls will be in every language and at every font scale (DQ-178). The skeleton is still hidden while it measures.
 */
function useLabelWidths(labels: readonly string[], variant: TypeVariant, textStyle?: StyleProp<TextStyle>) {
  const styles = useStyles();
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  const measured = (label: string) => (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidths((current) => (current[label] === next ? current : { ...current, [label]: next }));
  };
  const measure = (
    <View aria-hidden style={styles.measure}>
      {labels.map((label) => (
        <Text key={label} variant={variant} hyphenate={false} selectable={false} style={textStyle} onLayout={measured(label)}>
          {label}
        </Text>
      ))}
    </View>
  );
  return { widths, measure };
}

/** Button blocks the size of the real buttons, wrapping where they will. */
function ButtonBlocks({
  labels,
  buttonSize,
  icon,
  style,
  testID,
}: {
  labels: readonly string[];
  buttonSize: ButtonSize;
  icon: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
}) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { widths, measure } = useLabelWidths(labels, buttonSize === 's' ? 'labelS' : 'label');
  const height = buttonHeight(buttonSize, fontScale);
  const chrome = buttonChrome(buttonSize, icon);
  return (
    <View style={[styles.buttons, style]} testID={testID}>
      {labels.map((label) => (
        <SkeletonBlock
          key={label}
          width={Math.max(size.touchMin, chrome + (widths[label] ?? estimatedLabelWidth(label, buttonSize, fontScale)))}
          height={height}
          corner="sm"
        />
      ))}
      {measure}
    </View>
  );
}

/**
 * DQ-182: the lines of a text the garage already knows, broken where the page will break it, from its words measured in their
 * own type. `null` until they are measured or without a text; the skeleton then sets FS-3's example.
 */
function useKnownLines(text: string | undefined, variant: TypeVariant, spaceEm: number, fontScale: number, width: number) {
  const words = useMemo(() => (text ?? '').split(' ').filter(Boolean), [text]);
  const unique = useMemo(() => [...new Set(words)], [words]);
  const { widths, measure } = useLabelWidths(unique, variant);
  const measured = words.flatMap((word) => {
    const wordWidth = widths[word];
    return wordWidth === undefined ? [] : [wordWidth];
  });
  const lines =
    words.length > 0 && measured.length === words.length
      ? wrapWords({ words: measured, space: spaceEm * typography[variant].fontSize * fontScale }, 1, Math.max(0, width))
      : null;
  return { lines, measure };
}

/** What a skeleton can already know of the vehicle: GAR-02's garage card has it, VEH-01 does not. */
export type KnownProfile = { title: string; subline_parts: readonly string[] };

type SummarySkeletonProps = {
  routeId: string;
  width: number;
  fontScale: number;
  /** Folgen and Nachricht, for a guest and for a member on VEH-01. */
  ownerActions: readonly string[];
  /**
   * A member's pair in its widest state (DQ-262): the labels that decide whether the row stacks, the first with the check glyph.
   * Without it the guest's rule applies.
   */
  widestActions?: readonly string[];
  toolbarLabels?: readonly string[];
  known?: KnownProfile;
};

/** The width of Button M blocks side by side, 8 apart: the first with its glyph when `firstIcon`. */
function buttonRowWidth(labels: readonly string[], widths: Readonly<Record<string, number>>, fontScale: number, firstIcon: boolean): number {
  return labels.reduce(
    (total, label, index) =>
      total + (index > 0 ? space[8] : 0) + buttonChrome('m', firstIcon && index === 0) + (widths[label] ?? estimatedLabelWidth(label, 'm', fontScale)),
    0,
  );
}

function SummarySkeleton({ routeId, width, fontScale, ownerActions, widestActions, toolbarLabels, known }: SummarySkeletonProps) {
  const styles = useStyles();
  // Up to this font scale the page keeps each part of the sub-line whole (ProfileSummary, the same threshold).
  const wholeParts = fontScale <= STACK_FONT_SCALE;
  const knownSubline = known ? keptSubline({ subline_parts: [...known.subline_parts] }, wholeParts) : undefined;
  const title = useKnownLines(known?.title, 'displayL', BLUEPRINT_TITLE.space, fontScale, width);
  const subline = useKnownLines(knownSubline, 'supporting', BLUEPRINT_SUBLINE.space, fontScale, width);
  const withActions = ownerActions.length > 0;
  const widest = useLabelWidths(widestActions ?? [], 'label');
  const fits = widestActions
    ? width >= OWNER_IDENTITY_MIN_WIDTH + buttonRowWidth(widestActions, widest.widths, fontScale, true)
    : width >= OWNER_INLINE_MIN_WIDTH;
  const stacked = withActions && (fontScale > STACK_FONT_SCALE || !fits);
  const eyebrowWidth = Math.min(width, BLUEPRINT_EYEBROW_EM * typography.eyebrow.fontSize * fontScale);
  return (
    <View testID={`${routeId}.skeleton.summary`}>
      <SkeletonText variant="eyebrow" width={eyebrowWidth} />
      <BlueprintText
        lines={title.lines ?? blueprintLines(BLUEPRINT_TITLE, 'displayL', fontScale, width)}
        variant="displayL"
        style={styles.title}
        testID={`${routeId}.skeleton.title`}
      />
      {/* A known vehicle without a sub-line has none on the page either. */}
      {knownSubline === '' ? null : (
        <BlueprintText
          lines={subline.lines ?? blueprintLines(wholeParts ? BLUEPRINT_SUBLINE_PARTS : BLUEPRINT_SUBLINE, 'supporting', fontScale, width)}
          variant="supporting"
          style={styles.subline}
          testID={`${routeId}.skeleton.subline`}
        />
      )}
      {title.measure}
      {subline.measure}
      {widestActions ? widest.measure : null}
      <SkeletonBlock height={stripHeight(fontScale)} corner="md" style={styles.strip} testID={`${routeId}.skeleton.specStrip`} />
      <View style={[styles.owner, stacked || !withActions ? null : styles.ownerInline]} testID={`${routeId}.skeleton.ownerRow`}>
        <View style={styles.identity}>
          <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
          <View style={styles.names}>
            <SkeletonText variant="bodyStrong" width="50%" />
            <SkeletonText variant="supporting" width="70%" />
          </View>
        </View>
        {withActions ? (
          <ButtonBlocks
            labels={ownerActions}
            buttonSize="m"
            icon={false}
            style={stacked ? null : styles.buttonsInline}
            testID={`${routeId}.skeleton.ownerActions`}
          />
        ) : null}
      </View>
      {toolbarLabels ? (
        <ButtonBlocks labels={toolbarLabels} buttonSize="s" icon style={styles.toolbar} testID={`${routeId}.skeleton.ownerToolbar`} />
      ) : null}
    </View>
  );
}

/** The desktop gallery's small photos under the hero, as DesktopThumbs lays them out. */
function ThumbsSkeleton({ photoCount, testID }: { photoCount: number; testID: string }) {
  const rowStyles = useThumbRowStyles();
  const { thumbs, columns } = thumbLayout(photoCount);
  if (thumbs === 0) return null;
  return (
    <View style={rowStyles.row} testID={testID}>
      {Array.from({ length: columns }, (_, index) =>
        index < thumbs ? (
          <SkeletonBlock key={index} aspectRatio={THUMB_RATIO} corner="sm" style={rowStyles.tile} />
        ) : (
          <View key={index} style={rowStyles.tile} />
        ),
      )}
    </View>
  );
}

/** The content tabs: each label where ContentTabs sets it, 12 of padding on either side of it, then the hairline. */
function TabsSkeleton({ gutter, labels }: { gutter: number; labels: readonly string[] }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { widths, measure } = useLabelWidths(labels, 'labelS', styles.tabLabel);
  return (
    <View style={styles.tabs}>
      <View style={[styles.tabRow, { paddingHorizontal: gutter }]}>
        {labels.map((label) => (
          <SkeletonText key={label} variant="labelS" width={widths[label] ?? estimatedLabelWidth(label, 's', fontScale)} />
        ))}
        {measure}
      </View>
      <View style={styles.hairline} />
    </View>
  );
}

function PanelSkeleton({ gutter }: { gutter: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.panel, { paddingHorizontal: gutter }]}>
      <SkeletonText variant="body" lines={ROW_COUNT} />
    </View>
  );
}

export type VehicleProfileSkeletonProps = {
  routeId?: string;
  onBack: () => void;
  /**
   * GAR-02: the owner toolbar's labels in their order. The owner row then has no actions, as on the page; without them a
   * guest sees the blocks of Folgen and Nachricht.
   */
  toolbarLabels?: readonly string[];
  /** The vehicle's photos when they are known (GAR-02's garage card): how many thumbnails a desktop draws. */
  photoCount?: number;
  /** The vehicle's title and sub-line when they are known (GAR-02's garage card): the text is set at its real lines. */
  known?: KnownProfile;
};

/**
 * The loading state of VEH-01 and GAR-02 in the geometry of the page that replaces it (§8): hero, the desktop's
 * thumbnails, eyebrow, title, sub-line, strip, owner row, GAR-02's toolbar, tabs and the first lines. It shows after
 * 300 ms and never runs longer than the page.
 */
export function VehicleProfileSkeleton({ routeId = 'VEH-01', onBack, toolbarLabels, photoCount = DEFAULT_PHOTO_COUNT, known }: VehicleProfileSkeletonProps) {
  const { t } = useTranslation('vehicle');
  const { t: tProfile } = useTranslation('profile');
  const styles = useStyles();
  const layout = useProfileLayout();
  const { gutter } = useBreakpoint();
  const { fontScale } = useTheme();
  const status = useSessionStore((state) => state.status);
  const header = useCollapsingHeader();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [width, setWidth] = useContentWidth(layout);
  const bar = useEstimatedOverlayHeight();
  const tabLabels = PROFILE_TABS.map((value) => t(`tabs.${value}`));
  // As VehicleProfile: Folgen and Nachricht, never beside the owner toolbar. M2.8: a member gets them too, as most builds a member
  // opens are someone else's and that owner takes messages, so the content does not move down when the row arrives. Your own
  // build and an owner who takes no messages are the rare cases where it moves up instead.
  const ownerActions = toolbarLabels ? [] : [t('actions.follow'), t('actions.message')];
  const widestActions = !toolbarLabels && status === 'member' ? [tProfile('follow.following'), t('actions.message')] : undefined;
  const summary = (inner: number) => (
    <SummarySkeleton
      routeId={routeId}
      width={inner}
      fontScale={fontScale}
      ownerActions={ownerActions}
      widestActions={widestActions}
      toolbarLabels={toolbarLabels}
      known={known}
    />
  );

  let body: ReactNode;
  if (layout === 'desktop') {
    const inner = Math.min(width, layoutTokens.contentMax + 2 * space[24]) - 2 * space[24];
    const card = ((inner - space[24]) * DESKTOP_CARD_FLEX) / (DESKTOP_GALLERY_FLEX + DESKTOP_CARD_FLEX) - 2 * space[24];
    body = (
      <View style={styles.desktopRow}>
        <View style={styles.desktopGallery}>
          <SkeletonBlock width="100%" aspectRatio={HERO_RATIO} corner="md" />
          <ThumbsSkeleton photoCount={photoCount} testID={`${routeId}.skeleton.thumbs`} />
          <TabsSkeleton gutter={0} labels={tabLabels} />
          <PanelSkeleton gutter={0} />
        </View>
        <View style={styles.desktopAside}>
          <View style={styles.card}>{summary(card)}</View>
        </View>
      </View>
    );
  } else if (layout === 'tablet') {
    const inner = Math.min(width, TABLET_COLUMN) - 2 * gutter;
    body = (
      <View style={[styles.tabletColumn, { paddingHorizontal: gutter }]}>
        <SkeletonBlock width="100%" aspectRatio={HERO_RATIO} corner="md" />
        <View style={styles.summary}>{summary(inner)}</View>
        <TabsSkeleton gutter={0} labels={tabLabels} />
        <PanelSkeleton gutter={0} />
      </View>
    );
  } else {
    body = (
      <View>
        <SkeletonBlock width="100%" aspectRatio={HERO_RATIO} style={styles.flat} />
        <View style={[styles.summary, { paddingHorizontal: gutter }]}>{summary(width - 2 * gutter)}</View>
        <TabsSkeleton gutter={gutter} labels={tabLabels} />
        <PanelSkeleton gutter={gutter} />
      </View>
    );
  }

  return (
    <ProfileFrame
      routeId={routeId}
      layout={layout}
      overHero={layout === 'phone'}
      onBack={onBack}
      header={header}
      photoCollapseAt={Math.max(0, width / HERO_RATIO - bar)}
      scrollRef={scrollRef}
      onWidth={setWidth}
    >
      <Skeleton testID={`${routeId}.skeleton`}>{body}</Skeleton>
    </ProfileFrame>
  );
}
