import { useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type Animated from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import {
  createStyles,
  layout as layoutTokens,
  ThemeScope,
  type ThemeName,
  size,
  typography,
  typographyDesktop,
  useBreakpoint,
  useTheme,
  type SizedTypeVariant,
  type TypeVariant,
} from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import type { DisplayTitlePlacement } from '@/ui/displayTitleLayout';
import { useDesktopType } from '@/ui/Text';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { DESKTOP_CARD_FLEX, DESKTOP_GALLERY_FLEX, heroBox, heroIdentityOverlap, heroIdentityWidth, profileSummaryWidth, summaryTitlePlacement, TABLET_COLUMN, useProfileLayout } from '../layout';
import { keptSubline, PROFILE_TABS, SUBLINE_WHOLE_FONT_SCALE } from '../model';
import {
  BLUEPRINT_EYEBROW_EM,
  BLUEPRINT_SUBLINE,
  BLUEPRINT_SUBLINE_PARTS,
  BLUEPRINT_TITLE,
  blueprintLines,
  blueprintStripHeight,
  estimatedLabelWidth,
  displayTitleLines,
  knownTitleLines,
  wrapWords,
  type WordWidths,
} from '../skeletonGeometry';
import { ProfileFrame, useContentWidth, useEstimatedOverlayHeight } from './ProfileFrame';

/** The stage under the photo is dark in every theme (ADR-421 b): its bars take a dark theme's tones, as MediaCard's lead skeleton. */
const STAGE_THEME: ThemeName = 'carbon';
const ROW_COUNT = 3;

const useStyles = createStyles((t) => ({
  flat: { borderRadius: 0 },
  // DQ-1047: the photo's dark stage (every theme, ADR-421 b) with the identity bars over its bottom, in the stage's tones.
  stage: { alignSelf: 'center', backgroundColor: t.color.media.ground, maxWidth: layoutTokens.fullBleedMax, overflow: 'hidden', width: '100%' },
  stageIdentity: { paddingBottom: t.space[24] },
  chip: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], marginTop: t.space[8], minHeight: t.size.touchMin },
  canvas: { paddingTop: t.space[24] },
  actionRow: { gap: t.space[8], marginTop: t.space[16] },
  actionTriple: { flexDirection: 'row', gap: t.space[8] },
  actionItem: { flex: 1 },
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
  hairline: { backgroundColor: t.color.border.subtle, height: isWeb ? t.size.border.control : StyleSheet.hairlineWidth },
  panel: { gap: t.space[12], paddingBottom: t.space[32], paddingTop: t.space[24] },
  tabletColumn: { alignSelf: 'center', maxWidth: TABLET_COLUMN, width: '100%' },
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

/** FS-3's title or sub-line, line by line as the page breaks it (DQ-178). */
function BlueprintText({
  lines,
  variant,
  desktopSize = false,
  style,
  testID,
}: {
  lines: number[];
  variant: 'displayTitle' | 'title2' | 'callout';
  /** The role's desktop line box on the web desktop (the page title's 48). The shrunk title keeps title.2's 28 everywhere. */
  desktopSize?: boolean;
  style: StyleProp<ViewStyle>;
  testID: string;
}) {
  return (
    <SkeletonText
      variant={variant}
      desktopSize={desktopSize}
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

/**
 * DQ-182: the lines of a text the garage already knows, broken where the page will break it, from its words measured in their
 * own type. `null` until they are measured or without a text; the skeleton then sets FS-3's example.
 */
function useKnownLines(text: string | undefined, variant: SizedTypeVariant, spaceEm: number, fontScale: number, width: number) {
  const words = useMemo(() => (text ?? '').split(' ').filter(Boolean), [text]);
  const unique = useMemo(() => [...new Set(words)], [words]);
  const { widths, measure } = useLabelWidths(unique, variant);
  // The words are measured as Text draws them: at the role's desktop size on the web desktop (NH-3).
  const renderedSize = renderedFontSize(variant, useDesktopType());
  const measured = words.flatMap((word) => {
    const wordWidth = widths[word];
    return wordWidth === undefined ? [] : [wordWidth];
  });
  const complete = words.length > 0 && measured.length === words.length;
  const lines = complete ? wrapWords({ words: measured, space: spaceEm * renderedSize * fontScale }, 1, Math.max(0, width)) : null;
  /** The measured words in em of the variant at this font scale, for a rule that sets them at another size. */
  const em: WordWidths | null = complete ? { words: measured.map((wordWidth) => wordWidth / (renderedSize * fontScale)), space: spaceEm } : null;
  return { lines, em, measure };
}

/** The size Text sets a role at: its web desktop size on the web desktop where the role has one. */
function renderedFontSize(variant: SizedTypeVariant, desktop: boolean): number {
  const desktopType = desktop ? (typographyDesktop as Partial<Record<SizedTypeVariant, { fontSize: number }>>)[variant] : undefined;
  return (desktopType ?? typography[variant]).fontSize;
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
  /** ADR-426 b: `card` in the web desktop's side card (30/34 at every width), `page` on phones and tablets, as ProfileSummary. */
  titlePlacement: DisplayTitlePlacement;
};

/**
 * DQ-1047: the identity as it sits on the hero: eyebrow → 4 → title → 4 → sub-line → 8 → owner chip (avatar 32 + handle), each at
 * the line it takes on the page (the known title and sub-line where GAR-02 has them).
 */
function IdentityBars({ routeId, width, fontScale, known, titlePlacement }: Pick<SummarySkeletonProps, 'routeId' | 'width' | 'fontScale' | 'known' | 'titlePlacement'>) {
  const styles = useStyles();
  const desktop = useDesktopType();
  const wholeParts = fontScale <= SUBLINE_WHOLE_FONT_SCALE;
  const knownSubline = known ? keptSubline({ subline_parts: [...known.subline_parts] }, wholeParts) : undefined;
  const titleLines =
    (known ? knownTitleLines(known.title, fontScale, width, desktop, titlePlacement) : null) ??
    displayTitleLines(BLUEPRINT_TITLE, fontScale, width, desktop, titlePlacement);
  const subline = useKnownLines(knownSubline, 'callout', BLUEPRINT_SUBLINE.space, fontScale, width);
  const eyebrowWidth = Math.min(width, BLUEPRINT_EYEBROW_EM * typography.labelCaps.fontSize * fontScale);
  return (
    <View testID={`${routeId}.skeleton.identity`}>
      <SkeletonText variant="labelCaps" width={eyebrowWidth} />
      <BlueprintText
        lines={titleLines.lines}
        variant={titleLines.shrunk ? 'title2' : 'displayTitle'}
        desktopSize={!titleLines.shrunk && titlePlacement === 'page'}
        style={styles.title}
        testID={`${routeId}.skeleton.title`}
      />
      {knownSubline === '' ? null : (
        <BlueprintText
          lines={subline.lines ?? blueprintLines(wholeParts ? BLUEPRINT_SUBLINE_PARTS : BLUEPRINT_SUBLINE, 'callout', fontScale, width)}
          variant="callout"
          style={styles.subline}
          testID={`${routeId}.skeleton.subline`}
        />
      )}
      {subline.measure}
      <View style={styles.chip} testID={`${routeId}.skeleton.ownerRow`}>
        <SkeletonBlock width={size.avatar.sm} height={size.avatar.sm} corner="full" />
        <SkeletonText variant="callout" width={Math.min(width / 2, size.avatar.sm * 3)} />
      </View>
    </View>
  );
}

/** Under the hero: the strip, then the visitor's action row (Folgen, then Speichern · Teilen · Nachricht); the owner's capsule floats. */
function CanvasBars({ routeId, width, fontScale, owner }: { routeId: string; width: number; fontScale: number; owner: boolean }) {
  const styles = useStyles();
  const desktop = useDesktopType();
  const hairline = isWeb ? size.border.control : StyleSheet.hairlineWidth;
  return (
    <View testID={`${routeId}.skeleton.canvas`}>
      <SkeletonBlock height={blueprintStripHeight(width, fontScale, desktop, hairline)} corner="md" testID={`${routeId}.skeleton.specStrip`} />
      {owner ? null : (
        <View style={styles.actionRow} testID={`${routeId}.skeleton.actions`}>
          <SkeletonBlock width="100%" height={size.button.m} corner="sm" />
          <View style={styles.actionTriple}>
            {[0, 1, 2].map((key) => (
              <SkeletonBlock key={key} height={size.button.m} corner="sm" style={styles.actionItem} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** The content tabs: each label where ContentTabs sets it, 12 of padding on either side of it, then the hairline. */
function TabsSkeleton({ gutter, labels }: { gutter: number; labels: readonly string[] }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  // As ContentTabs: its labels are body.strong (15/22, 600).
  const { widths, measure } = useLabelWidths(labels, 'bodyStrong');
  return (
    <View style={styles.tabs}>
      <View style={[styles.tabRow, { paddingHorizontal: gutter }]}>
        {labels.map((label) => (
          <SkeletonText key={label} variant="bodyStrong" width={widths[label] ?? estimatedLabelWidth(label, 's', fontScale)} />
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
  /** The owner's page (GAR-02, an own VEH-01): no visitor action row under the strip; the capsule floats over the page (DQ-1049). */
  owner?: boolean;
  /** Kept for callers; the desktop has no thumbnails under the hero any more (DQ-1048). */
  photoCount?: number;
  /** The vehicle's title and sub-line when they are known (GAR-02's garage card): the text is set at its real lines. */
  known?: KnownProfile;
};

/**
 * The loading state of VEH-01 and GAR-02 in the geometry of the page that replaces it (§8, DQ-1047/1048): the hero's dark stage at
 * its aspect (4:5 on a phone, 16:9 from 768) with the identity bars over its bottom, then the strip and the actions, the tabs and the
 * first lines (the desktop: 8 columns of tabs beside the 4-column card).
 */
export function VehicleProfileSkeleton({ routeId = 'VEH-01', onBack, owner = false, known }: VehicleProfileSkeletonProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const layout = useProfileLayout();
  const { gutter } = useBreakpoint();
  const { fontScale } = useTheme();
  const header = useCollapsingHeader();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [width, setWidth] = useContentWidth(layout);
  const bar = useEstimatedOverlayHeight();
  const tabLabels = PROFILE_TABS.map((value) => t(`tabs.${value}`));
  const hero = heroBox(layout, width);
  const overlap = heroIdentityOverlap(hero.width, hero.ratio);
  const titlePlacement = summaryTitlePlacement(layout);

  const stage = (
    <View style={styles.stage} dataSet={{ qaExempt: 'photo' }} testID={`${routeId}.skeleton.stage`}>
      <View style={{ aspectRatio: hero.ratio }} testID={`${routeId}.skeleton.hero`} />
      <ThemeScope name={STAGE_THEME}>
        <View style={[styles.stageIdentity, { marginTop: -overlap, paddingHorizontal: gutter }]}>
          <IdentityBars routeId={routeId} width={heroIdentityWidth(layout, width, gutter)} fontScale={fontScale} known={known} titlePlacement={titlePlacement} />
        </View>
      </ThemeScope>
    </View>
  );
  // The width ProfileSummary is laid out at, from the same function as VehicleProfile (N1b).
  const summaryWidth = profileSummaryWidth(layout, width, gutter);
  const canvas = <CanvasBars routeId={routeId} width={summaryWidth} fontScale={fontScale} owner={owner} />;

  let body: ReactNode;
  if (layout === 'desktop') {
    body = (
      <View>
        {stage}
        <View style={styles.desktopRow}>
          <View style={styles.desktopGallery}>
            <TabsSkeleton gutter={0} labels={tabLabels} />
            <PanelSkeleton gutter={0} />
          </View>
          <View style={styles.desktopAside}>
            <View style={styles.card}>{canvas}</View>
          </View>
        </View>
      </View>
    );
  } else if (layout === 'tablet') {
    body = (
      <View>
        {stage}
        <View style={[styles.tabletColumn, { paddingHorizontal: gutter }]}>
          <View style={styles.canvas}>{canvas}</View>
          <TabsSkeleton gutter={0} labels={tabLabels} />
          <PanelSkeleton gutter={0} />
        </View>
      </View>
    );
  } else {
    body = (
      <View>
        {stage}
        <View style={[styles.canvas, { paddingHorizontal: gutter }]}>{canvas}</View>
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
      photoCollapseAt={Math.max(0, hero.width / hero.ratio - bar)}
      scrollRef={scrollRef}
      onWidth={setWidth}
    >
      <Skeleton testID={`${routeId}.skeleton`}>{body}</Skeleton>
    </ProfileFrame>
  );
}
