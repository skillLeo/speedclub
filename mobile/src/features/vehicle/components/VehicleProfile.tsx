import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';

import { useFlag } from '@/api/queries/appConfig';
import { buildProgressOf } from '@/api/queries/plans';
import { forgetBlockedMember } from '@/api/queries/social';
import { SOCIAL_FLAGS, vehicleCommentsEnabled } from '@/api/queries/social2';
import { type BuildUpdate, type PublicModRow, type PublicVehicle } from '@/api/queries/vehicles';
import { FeedComments } from '@/features/home/components/FeedComments';
import { BuildGoalBlock, hasVisibleGoal } from '@/features/insights/components/BuildGoalBlock';
import { newMessageHref } from '@/features/messages/entry';
import { useReport } from '@/features/safety/useReport';
import { BuildScoreSection } from '@/features/score/components/BuildScoreSection';
import { isWeb } from '@/lib/platform';
import { qa, useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout as layoutTokens, size, space, useBreakpoint, zIndex } from '@/theme';
import { type ContextMenuItem } from '@/ui/ContextMenu';
import { type HeaderAction } from '@/ui/Header';
import { OwnerCapsule, type OwnerCapsuleAction } from '@/ui/OwnerCapsule';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { StretchyHero } from '@/ui/motion/kit';

import { COMPARE_FLAG } from '../compare';
import { desktopColumns, hasSideIndex, heroAspect, heroBox, heroIdentityOverlap, heroIdentityWidth, profileSummaryWidth, scrimOverlapDataSet, TABLET_COLUMN, useProfileLayout } from '../layout';
import { visiblePhotos } from '../media';
import { ownerName } from '../model';
import { planHref } from '../navigation';
import { sectionsFor, type ProfileAnchor, type ProfileSection, type SpyGeometry } from '../sections';
import { SHARE_CARD_FLAG } from '../shareCard';
import { useVehicleShare } from '../share';
import { CarCommentsEntry, carCommentsEntryMode } from './CarComments';
import { ComparePicker } from './ComparePicker';
import { DesktopCard } from './DesktopCard';
import { FlowPinnedCopy, FlowPinnedRow, usePinStore } from './FlowPinned';
import { HighlightsRail } from './HighlightsRail';
import { MoreSheet, type MoreAction } from './MoreSheet';
import {
  BuildDiscussionsSlot,
  BuildProgressCard,
  DataSection,
  GallerySection,
  HistoryPreview,
  ModsSection,
  ProfileFooter,
  SectionTitle,
  useDiscussionsSlot,
} from './OnePageSections';
import { PhotoViewer } from './PhotoViewer';
import { Pinned } from './Pinned';
import { PlansSection } from './PlansSection';
import { ProfileFrame, useContentWidth, useEstimatedOverlayHeight } from './ProfileFrame';
import { ProfileHero, type ProfileHeroHandle } from './ProfileHero';
import { OverviewSection } from './ProfileSections';
import { ProfileSummary, VehicleIdentity } from './ProfileSummary';
import { SectionIndex } from './SectionIndex';
import { SimilarBuilds } from './SimilarBuilds';
import { SectionHeadingsContext, useSectionHeadings } from './sectionFocus';
import { useCurrentSection, useSectionScroll, type CurrentSectionStore } from './useSectionScroll';
import { VehicleActions } from './VehicleActions';

export type VehicleProfileProps = {
  /** `PublicVehicleResource` as the API renders it for this viewer. */
  vehicle: PublicVehicle;
  /**
   * Prefix of every test ID. VEH-01 keeps `VEH-01.hero`, `.title`, `.specStrip`, `.ownerRow` for the parity test with
   * WEB-01; GAR-02 passes its own.
   */
  routeId?: string;
  onBack: () => void;
  /** Replaces share and more in the header. */
  headerActions?: readonly HeaderAction[];
  /**
   * GAR-02 owner toolbar (Bearbeiten, Mods, Fotos, QR, Sichtbarkeit), under the owner row and in the desktop card. With a
   * toolbar the owner row has no actions.
   */
  ownerToolbar?: ReactNode;
  /** DQ-1062: GAR-02's capsule (its glyph actions and the extra "Mehr" items) instead of VEH-01's owner capsule. */
  capsule?: { actions: readonly OwnerCapsuleAction[]; more: readonly ContextMenuItem[] };
  /** GAR-02 owner-only content, first in Überblick: completeness hints and the like. */
  ownerContent?: ReactNode;
  /** When the page's data was read (ms), for the offline line "zuletzt aktualisiert vor 5 Min." (DQ-1068). */
  updatedAt?: number;
  /** A deep link's section (`?section=`, or a 2.0 link's `?tab=`): the page opens scrolled to it. */
  initialSection?: ProfileAnchor;
};

type RowKind = 'stage' | 'summary' | 'index' | 'section' | 'discussions' | 'similar' | 'footer';
type Row = { key: string; kind: RowKind; section?: ProfileSection };

const keyOf = (row: Row) => row.key;
const typeOf = (row: Row) => (row.kind === 'section' ? (row.section ?? row.kind) : row.kind);

const useStyles = createStyles((t) => ({
  // DQ-1047/1048: the photo fades into the dark stage (every theme, ADR-421 b), the identity on it; full width, at most fullBleedMax.
  stage: { alignSelf: 'center', backgroundColor: t.color.scrim.photoEnd, maxWidth: layoutTokens.fullBleedMax, width: '100%' },
  heroIdentity: { paddingBottom: t.space[24] },
  // On the canvas, so the hero trailing behind at half speed (SM5) slides under it. 24 from the hero to the strip (DQ-1047).
  // 16 under the actions, then the section index.
  summaryPhone: { backgroundColor: t.color.bg.canvas, paddingBottom: t.space[16], paddingTop: t.space[24] },
  canvas: { backgroundColor: t.color.bg.canvas },
  sectionGapBelow: { marginBottom: t.space[32] },
  sectionGap: { marginTop: t.space[32] },
  capsule: { alignSelf: 'flex-start' },
  tabletColumn: { alignSelf: 'center', maxWidth: TABLET_COLUMN, width: '100%' },
  // 10 §5: one section after the other, 48 between sections (64 on the desktop, 09 §4.5 web). The gap sits under each section, so a
  // section's row starts at its heading and a jump puts the heading 16 under the index.
  section: { paddingBottom: t.space[48] },
  sectionWide: { paddingBottom: t.space[64] },
  // 24 from the index (its slot) or the hero (the desktop's side index) to Überblick.
  indexSlotGap: { paddingBottom: t.space[24] },
  desktopFirst: { paddingTop: t.space[24] },
  // The 12-column row under the hero (`desktopColumns`): centred, at most contentMax + 2 × 24, 24 at its sides and between columns.
  desktopGrid: {
    alignSelf: 'center',
    columnGap: t.space[24],
    flexDirection: 'row',
    maxWidth: layoutTokens.contentMax + 2 * t.space[24],
    paddingHorizontal: t.space[24],
    width: '100%',
  },
  footer: { paddingBottom: t.space[32], paddingTop: t.space[32] },
}));

/** DQ-M53-04: under a QA override every row draws at once (a distance far past any page), for deterministic full-page pictures. */
const QA_CAPTURE = Object.keys(qa).length > 0;
const QA_DRAW_DISTANCE = 100_000;
/** The page counts as measured once its content height has not changed for this long (the harness waits for the marker). */
const SETTLED_AFTER_MS = 300;

/** Web: the list header that holds the pinned blocks: no height of its own, stuck to the scroller's top, above the rows. */
const PINNED_HEADER_STYLE = { height: 0, position: 'sticky', top: 0, zIndex: zIndex.sticky } as unknown as ViewStyle;

/** The chip row's height before its first layout: the 32 chip (its 44 target reaches past it), 4 above and below, the hairline. */
const INDEX_ESTIMATE = size.chip + 2 * space[4] + size.border.control;

/** Only the index listens to the spy, so the page's rows never render again while the reader scrolls. */
function LiveSectionIndex({ store, ...props }: Omit<Parameters<typeof SectionIndex>[0], 'current'> & { store: CurrentSectionStore }) {
  const current = useCurrentSection(store);
  return <SectionIndex {...props} current={current} />;
}

/**
 * VEH-01, FS-3 in its 2.1 form (10 §5, ADR-505): the public build page as one virtualised scroll, and the body of GAR-02 ("public
 * layout + owner toolbar"). Hero → identity → SpecStrip → actions → the section index (pinned, scroll-spy) → Überblick · Daten · Mods ·
 * Pläne · Verlauf · Galerie → the forum slot → Ähnliche Builds → footer. See features/vehicle/README.md for the slots. It renders the
 * screen with its header; the route decides the states around it (loading, unavailable, error).
 */
export function VehicleProfile({
  vehicle,
  routeId = 'VEH-01',
  onBack,
  headerActions,
  ownerToolbar,
  ownerContent,
  capsule,
  updatedAt,
  initialSection,
}: VehicleProfileProps) {
  const { t, i18n } = useTranslation('vehicle');
  const { t: tMessages } = useTranslation('messages');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const layout = useProfileLayout();
  const { gutter } = useBreakpoint();
  const header = useCollapsingHeader();
  const listRef = useRef<FlashListRef<Row>>(null);
  const heroRef = useRef<ProfileHeroHandle>(null);
  const [width, setWidth] = useContentWidth(layout);
  const estimatedOverlay = useEstimatedOverlayHeight();
  const [overlayHeight, setOverlayHeight] = useState<number | null>(null);
  const [indexHeight, setIndexHeight] = useState<number | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const compareEnabled = useFlag(COMPARE_FLAG);
  const shareCardEnabled = useFlag(SHARE_CARD_FLAG);
  const discussions = useDiscussionsSlot();
  const qaState = useQaState();
  const { share, copy, sharing } = useVehicleShare(routeId);

  const format = useFormat();
  const offlineLabel = updatedAt ? t('offline.read', { time: format.relative(new Date(updatedAt)) }) : t('offline.readNoTime');
  const slug = vehicle.slug;
  const photos = useMemo(() => visiblePhotos(vehicle.photos), [vehicle.photos]);
  // DQ-1211: a build without photos has WEB-01's empty stage photo there, so the bar floats over a photo on every build.
  const overHero = layout === 'phone';
  const barHeight = overlayHeight ?? estimatedOverlay;

  // DQ-1047/1048: the hero at every width (4:5 on a phone, 16:9 across the content from 768) with the identity on its scrim.
  const { height: windowHeight } = useWindowDimensions();
  const { width: heroWidth, ratio: heroRatio } = heroBox(layout, width, windowHeight);
  const heroHeight = heroWidth / heroRatio;
  const overlap = heroIdentityOverlap(heroWidth, heroRatio);

  const client = useQueryClient();
  const owner = vehicle.owner;
  const ownVehicle = vehicle.is_owner || Boolean(owner?.is_self);
  // The owner's tools in the sections (an empty section's one action, Pläne's reorder and "Als verbaut markieren").
  const manages = vehicle.is_owner;
  const openOwner =
    owner?.username && !ownerToolbar
      ? () => (owner.is_self ? router.navigate('/profile') : router.push({ pathname: '/u/[username]', params: { username: owner.username ?? '' } }))
      : undefined;
  const askToSignIn = () => {
    requireAuth(undefined, { returnTo: pathname });
  };
  const guestContact = Boolean(owner) && !ownVehicle && status !== 'member' && !ownerToolbar;

  // DQ-942: at most two floating controls over the hero — back and "Mehr". Speichern and Teilen live in the action row
  // (09 §7.6 (4)); "Link kopieren" stays in the sheet.
  const actions: readonly HeaderAction[] = headerActions ?? [
    { icon: 'dots-three', label: t('actions.more'), onPress: () => setMoreOpen(true), testID: `${routeId}.moreActions` },
  ];

  // M2.6: "Melden" for someone else's build; a block from the report flow leaves the page, as PROF-02's does.
  // R5-5: the car's own comments, in the feed card's sheet. Mounted from the first opening on (its report flow outlives it); a
  // `comment` notification on the car opens the page with it (`?comments=1`), once.
  const commentsFlag = useFlag(SOCIAL_FLAGS.comments);
  const commentsMode = carCommentsEntryMode(vehicle, commentsFlag);
  const [commentsMounted, setCommentsMounted] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const openComments = useCallback(() => {
    setCommentsMounted(true);
    setCommentsOpen(true);
  }, []);
  const { comments: commentsParam } = useLocalSearchParams<{ comments?: string }>();
  const commentsAsked = useRef(false);
  useEffect(() => {
    if (commentsAsked.current || commentsParam !== '1' || commentsMode === 'hidden') return;
    commentsAsked.current = true;
    openComments();
    router.setParams({ comments: undefined });
  }, [commentsMode, commentsParam, openComments, router]);

  const report = useReport(
    { type: 'vehicle', id: vehicle.id, label: vehicle.full_title, ...(owner?.username ? { owner: owner.username } : {}) },
    {
      routeId,
      onBlocked: (blocked) => {
        onBack();
        forgetBlockedMember(client, blocked);
      },
    },
  );
  const reportable = report.available && !ownVehicle && !ownerToolbar;

  const moreActions: MoreAction[] = [
    ...(ownVehicle || ownerToolbar ? [{ key: 'share', icon: 'share-network', label: t('actions.share'), onPress: () => void share(vehicle) } satisfies MoreAction] : []),
    { key: 'copyLink', icon: 'link', label: t('more.copyLink'), onPress: () => void copy(vehicle) },
    ...(vehicle.is_owner
      ? [{ key: 'garage', icon: 'garage', label: t('more.openGarage'), onPress: () => router.push(`/garage/${vehicle.id}`) } satisfies MoreAction]
      : []),
    ...(vehicle.is_owner && vehicle.qr
      ? [{ key: 'qr', icon: 'qr-code', label: t('more.qr'), onPress: () => router.push(`/stickers/${vehicle.id}`) } satisfies MoreAction]
      : []),
    // [SIG] Only a published build has a card and can be compared: a draft or private car has no public counterpart.
    ...(shareCardEnabled && vehicle.status === 'published' && vehicle.visibility !== 'private'
      ? [{ key: 'shareCard', icon: 'image', label: t('more.shareCard'), onPress: () => router.push({ pathname: '/share-card/[vehicleId]', params: { vehicleId: vehicle.id } }) } satisfies MoreAction]
      : []),
    ...(compareEnabled && vehicle.status === 'published'
      ? [{ key: 'compare', icon: 'arrows-left-right', label: t('more.compare'), onPress: () => setComparing(true) } satisfies MoreAction]
      : []),
    // M2.4: "Fahrzeug senden" shares the build as a card in a conversation (MSG-03).
    ...(status === 'member' && vehicle.status === 'published' && vehicle.visibility !== 'private'
      ? [{ key: 'sendVehicle', icon: 'chat-circle', label: tMessages('entry.sendVehicle'), onPress: () => router.push(newMessageHref({ vehicle: vehicle.slug })) } satisfies MoreAction]
      : []),
    ...(reportable ? [{ key: 'report', icon: 'flag', label: report.label, onPress: report.open } satisfies MoreAction] : []),
  ];

  const openMod = useCallback((mod: PublicModRow) => router.push(`/v/${slug}/mods/${mod.id}`), [router, slug]);
  const openUpdate = useCallback((update: BuildUpdate) => router.push(`/v/${slug}/updates/${update.id}`), [router, slug]);
  const openGallery = () => router.push(`/v/${slug}/gallery`);
  const openHistory = () => router.push({ pathname: '/v/[slug]/history', params: { slug } });

  // ---- one scroll: sections, the index and its geometry ------------------------------------------------------------------------
  const sections = useMemo(() => sectionsFor(vehicle, manages), [manages, vehicle]);
  const sideIndex = hasSideIndex(layout, width);
  const columns = layout === 'desktop' ? desktopColumns(width, sideIndex) : null;
  const chipRow = !sideIndex;
  const measuredIndex = indexHeight ?? INDEX_ESTIMATE;
  // The chip row stops under the floating bar on a phone, at the top of the scroller under a bar everywhere else; the side list at 24.
  const pinnedTop = sideIndex ? space[24] : overHero ? barHeight : 0;
  const geometry = useMemo<SpyGeometry>(
    () => ({ pinnedTop, indexHeight: chipRow ? measuredIndex : 0, gap: space[16] }),
    [chipRow, measuredIndex, pinnedTop],
  );

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [{ key: 'stage', kind: 'stage' }];
    if (layout !== 'desktop') list.push({ key: 'summary', kind: 'summary' });
    if (chipRow) list.push({ key: 'index', kind: 'index' });
    for (const section of sections) list.push({ key: section, kind: 'section', section });
    if (discussions) list.push({ key: 'discussions', kind: 'discussions' });
    list.push({ key: 'similar', kind: 'similar' }, { key: 'footer', kind: 'footer' });
    return list;
  }, [chipRow, discussions, layout, sections]);

  const scroll = useSectionScroll({ listRef, scrollY: header.scrollY, rows, keyOf, sections, geometry });
  // R4-1.1: on the web's phone and tablet layouts the chip row scrolls natively in its row and a fixed copy takes over at the bar
  // (`FlowPinned`): the browser scrolls on the compositor and reports late, so a per-frame translate there lags and jumps.
  const flowPin = isWeb && layout !== 'desktop' && chipRow;
  const pinStore = usePinStore(header.scrollY, scroll.rowTops, 'index', pinnedTop, flowPin);
  const headings = useSectionHeadings();
  const listStyle = useAnimatedStyle(() => ({ flex: 1, opacity: scroll.listOpacity.get() }));
  // DQ-M53-04: a marker for the visual harness once the content height holds still (every row measured, nothing estimated).
  const [settled, setSettled] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSettled = (height: number) => {
    if (!QA_CAPTURE) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setSettled(false);
    settleTimer.current = setTimeout(() => setSettled(height > 0), SETTLED_AFTER_MS);
  };
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);
  const opened = useRef<ProfileAnchor | undefined>(initialSection);
  const openInitial = () => {
    const anchor = opened.current;
    if (!anchor) return;
    opened.current = undefined;
    scroll.scrollTo(anchor, { animated: false });
  };

  // The bar of a tablet shows the title once the page title has passed under it.
  const onTitleLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    // On the hero (or the empty stage, DQ-1211) the identity starts `overlap` above the photo's bottom edge.
    header.collapseAt.set(heroHeight - overlap + y + height);
  };

  const heroBody = (
    <ProfileHero
      ref={heroRef}
      photos={photos}
      width={heroWidth}
      corner="none"
      vehicleTitle={vehicle.full_title}
      onOpen={setViewerIndex}
      ratio={heroRatio}
      aspect={heroAspect(layout)}
      identityOverlap={overlap}
      routeId={routeId}
    />
  );
  // SM5 on the phone's edge-to-edge hero: it stretches on pull-down and trails at half speed; reduced motion keeps it still.
  const hero = overHero ? (
    <StretchyHero scrollY={header.scrollY} headerHeight={barHeight} testID={`${routeId}.stretchy`}>
      {heroBody}
    </StretchyHero>
  ) : (
    heroBody
  );
  const stage = (
    <View style={styles.stage} testID={`${routeId}.stage`}>
      {hero}
      <VehicleIdentity
        vehicle={vehicle}
        routeId={routeId}
        tone="photo"
        layoutWidth={heroIdentityWidth(layout, width, gutter)}
        onOpenOwner={openOwner}
        // DQ-M53-02: from 1280 the owner is in the right card, so the hero names the car only.
        showOwner={layout !== 'desktop'}
        onTitleLayout={onTitleLayout}
        headMinHeight={overlap}
        dataSet={scrimOverlapDataSet(overlap)}
        style={[styles.heroIdentity, { marginTop: -overlap, paddingHorizontal: gutter }]}
      />
    </View>
  );

  // DQ-1049: on phones and tablets the capsule floats above the tab bar (ProfileFrame `floating`); the desktop card keeps it in place.
  const capsuleFloats = layout !== 'desktop';
  // 09 §7.6 (4): visitors get the action row, the owner the capsule (DQ-1062: GAR-02 too, with its own glyph actions).
  const capsuleActions = capsule?.actions ?? [
    { key: 'qr', icon: 'qr-code', label: t('actions.qr'), onPress: () => router.push(`/stickers/${vehicle.id}`), priority: 0 },
    { key: 'edit', icon: 'pencil-simple', label: t('actions.edit'), onPress: () => router.push(`/garage/${vehicle.id}`), priority: 1 },
    { key: 'mods', icon: 'wrench', label: t('actions.mods'), onPress: () => router.push(`/garage/${vehicle.id}/mods`), priority: 2 },
    { key: 'photos', icon: 'image', label: t('actions.photos'), onPress: () => router.push(`/garage/${vehicle.id}/photos`), priority: 3 },
  ] satisfies OwnerCapsuleAction[];
  const shareItem = { key: 'share', label: t('actions.share'), icon: 'share-network' as const, onSelect: () => void share(vehicle) };
  const capsuleMore: ContextMenuItem[] = [...(capsule?.more ?? [shareItem])];
  const ownerCapsule =
    (vehicle.is_owner || capsule) && !ownerToolbar ? (
      <OwnerCapsule
        primary={{ label: t('actions.postUpdate'), onPress: () => router.push({ pathname: '/post-update', params: { vehicleId: vehicle.id } }) }}
        actions={capsuleActions}
        more={{ label: t('actions.more'), items: capsuleMore }}
        label={t('actions.ownerLabel')}
        style={capsuleFloats ? undefined : styles.capsule}
        availableWidth={capsuleFloats ? undefined : profileSummaryWidth(layout, width, gutter)}
        testID={`${routeId}.ownerCapsule`}
      />
    ) : null;
  const actionRow =
    ownVehicle || ownerToolbar
      ? capsuleFloats
        ? null
        : ownerCapsule
      : <VehicleActions vehicle={vehicle} routeId={routeId} onShare={() => void share(vehicle)} sharing={sharing} />;

  const summary = (variant: 'page' | 'card') => (
    <ProfileSummary
      vehicle={vehicle}
      routeId={routeId}
      variant={variant}
      identity="none"
      // N1b: the strip knows its width before its own layout, so its first frame already has its final columns.
      layoutWidth={profileSummaryWidth(layout, width, gutter)}
      onOpenOwner={openOwner}
      actions={actionRow}
      ownerToolbar={ownerToolbar}
      // DQ-1211: without photos the stage carries the identity; one line says so, and the owner gets the one way to add them.
      noPhotos={photos.length === 0 ? { ownerUsername: ownVehicle ? null : (owner?.username ?? null), onAdd: vehicle.is_owner ? () => router.push(`/garage/${vehicle.id}/photos`) : undefined } : undefined}
    />
  );

  // The column every row after the summary sits in: the phone's gutters, the tablet's centred 768, the desktop's content columns.
  const columnWidth = columns ? columns.gallery : layout === 'tablet' ? Math.min(width, TABLET_COLUMN) - 2 * gutter : width - 2 * gutter;
  const column = (children: ReactNode, style?: StyleProp<ViewStyle>) => {
    // DQ-M53R2 (audit): the desktop grid is a row of column widths with the 24 gutter as its gap, so no derived margin appears.
    if (columns) {
      return (
        <View style={[styles.desktopGrid, style]}>
          {sideIndex ? <View style={{ width: columns.index }} /> : null}
          <View style={{ width: columns.gallery }}>{children}</View>
        </View>
      );
    }
    if (layout === 'tablet') return <View style={[styles.tabletColumn, { paddingHorizontal: gutter }, style]}>{children}</View>;
    return <View style={[{ paddingHorizontal: gutter }, style]}>{children}</View>;
  };

  const progress = buildProgressOf(vehicle);
  const sectionBody = (section: ProfileSection): ReactNode => {
    switch (section) {
      case 'overview':
        return (
          <>
            <SectionTitle title={t('sections.overview')} section="overview" testID={`${routeId}.section.overview.title`} />
            <OverviewSection
              vehicle={vehicle}
              routeId={routeId}
              ownerContent={ownerContent}
              // M5.9c ★: the Build Score section brings its own gap (none when it has nothing to show).
              // DQ-M53-17: the forced empty state has no score to show either.
              // R6-3: on the web desktop the gauge sits in the right-hand side card; Überblick keeps the owner's "Nächstes Upgrade".
              score={(first) =>
                qaState === 'empty' ? null : (
                  <BuildScoreSection vehicle={vehicle} routeId={routeId} part={columns ? 'next' : 'all'} style={first ? styles.sectionGapBelow : styles.sectionGap} />
                )
              }
              pins={(first) => (
                // DQ-1056: the rail brings its own gap, so a rail that has nothing to show leaves no ghost space.
                <HighlightsRail
                  vehicle={vehicle}
                  routeId={routeId}
                  bleed={layout === 'phone' ? gutter : 0}
                  onOpenUpdate={(id) => router.push(`/v/${slug}/updates/${id}`)}
                  onOpenPhoto={setViewerIndex}
                  style={first ? styles.sectionGapBelow : styles.sectionGap}
                />
              )}
              progress={
                // M5.7 (10 §6.2): the build goal and, for the owner, the way to INS-01 sit with the card (features/insights).
                manages || (progress?.planned ?? 0) > 0 || hasVisibleGoal(vehicle, manages) ? (
                  <BuildGoalBlock vehicle={vehicle} routeId={routeId} owner={manages}>
                    {manages || (progress?.planned ?? 0) > 0 ? (
                      <BuildProgressCard
                        progress={progress}
                        routeId={routeId}
                        owner={manages}
                        onShowPlans={() => scroll.scrollTo('plans')}
                        onPlan={() => router.push(planHref(vehicle.id))}
                      />
                    ) : null}
                  </BuildGoalBlock>
                ) : null
              }
              comments={commentsMode === 'hidden' ? null : <CarCommentsEntry vehicle={vehicle} onOpen={openComments} routeId={routeId} />}
              onWriteDescription={manages ? () => router.push(`/garage/${vehicle.id}/basics`) : undefined}
              order={manages ? 'owner' : 'visitor'}
            />
          </>
        );
      case 'specs':
        return <DataSection vehicle={vehicle} routeId={routeId} owner={manages} width={columnWidth} />;
      case 'mods':
        return <ModsSection vehicle={vehicle} routeId={routeId} owner={manages} onOpenMod={openMod} />;
      case 'plans':
        return <PlansSection vehicle={vehicle} routeId={routeId} owner={manages} onOpenMod={openMod} onDragging={setDragging} />;
      case 'history':
        return <HistoryPreview vehicle={vehicle} routeId={routeId} onOpenUpdate={openUpdate} onShowAll={openHistory} />;
      case 'gallery':
        return <GallerySection vehicle={vehicle} routeId={routeId} onOpenGallery={openGallery} onOpenPhoto={setViewerIndex} />;
    }
  };

  const indexItems = sections.map((key) => ({ key, label: t(`sections.${key}`) }));
  // Review SF-4: a keyboard or screen-reader jump moves focus to the section's heading once it is in place.
  const selectSection = (key: ProfileSection, options: { focus: boolean }) =>
    scroll.scrollTo(key, options.focus ? { onArrive: () => void headings.focus(key) } : {});
  // The chip row of phones and tablets (pinned by `Pinned` on native, in its row with a fixed copy on the web): the full width on a
  // phone, the centred 768 column on a tablet.
  const indexRowLeft = layout === 'tablet' ? Math.max(0, (width - Math.min(width, TABLET_COLUMN)) / 2) : 0;
  const indexRowWidth = layout === 'tablet' ? Math.min(width, TABLET_COLUMN) : width;
  const chipIndex = (
    <LiveSectionIndex store={scroll.current} items={indexItems} onSelect={selectSection} orientation="row" label={t('sections.label')} gutter={gutter} testID={`${routeId}.sections`} />
  );

  const firstAfterStage = rows[1]?.key ?? 'footer';
  const renderRow = ({ item }: { item: Row }) => {
    switch (item.kind) {
      case 'stage':
        return stage;
      case 'summary':
        return layout === 'tablet' ? (
          <View style={styles.canvas}>
            <View style={[styles.tabletColumn, { paddingHorizontal: gutter }]}>
              <View style={styles.summaryPhone}>{summary('page')}</View>
            </View>
          </View>
        ) : (
          <View style={[styles.summaryPhone, { paddingHorizontal: gutter }]}>{summary('page')}</View>
        );
      case 'index':
        if (flowPin) {
          return (
            <FlowPinnedRow store={pinStore} height={measuredIndex} onHeight={setIndexHeight} style={[layout === 'tablet' ? styles.tabletColumn : null, styles.indexSlotGap]}>
              {chipIndex}
            </FlowPinnedRow>
          );
        }
        // The pinned chip row's place in the page (it is drawn by `Pinned`, outside the list), and 24 to Überblick.
        return column(<View style={{ height: measuredIndex }} />, [columns && item.key === firstAfterStage ? styles.desktopFirst : null, styles.indexSlotGap]);
      case 'section': {
        const section = item.section ?? 'overview';
        const first = sections[0] === section;
        const gap = [first && columns && !chipRow ? styles.desktopFirst : null, columns ? styles.sectionWide : styles.section];
        return column(
          <View nativeID={`${routeId}-section-${section}`} testID={`${routeId}.section.${section}`}>
            {sectionBody(section)}
          </View>,
          gap,
        );
      }
      case 'discussions':
        // DQ-P5-072: the section gap sits on the block (not on this column), so nothing adds space when the slot draws nothing.
        return column(<BuildDiscussionsSlot vehicle={vehicle} routeId={routeId} style={columns ? styles.sectionWide : styles.section} />);
      case 'similar':
        return column(
          <SimilarBuilds vehicleId={vehicle.id} title={vehicle.full_title} bleed={layout === 'desktop' ? 0 : gutter} testID={`${routeId}.similar`} />,
        );
      case 'footer':
        return column(
          <ProfileFooter
            routeId={routeId}
            // DQ-1057: only a guest gets the line ("Melde dich an, um Lukas zu schreiben."); a member writes from the action row.
            guestLine={guestContact && owner ? { text: t('overview.closingGuest', { name: ownerName(owner) }), label: t('overview.closingSignIn'), onPress: askToSignIn } : null}
            report={reportable ? { label: report.label, onPress: report.open } : null}
          />,
          styles.footer,
        );
    }
  };

  // Review SF-5: a vertical pan over a pinned block scrolls the list (native), within its range.
  const { contentHeight, viewport } = scroll;
  const scrollPinnedTo = useCallback(
    (offset: number) => listRef.current?.scrollToOffset({ offset: Math.min(offset, Math.max(0, contentHeight.get() - viewport.get())), animated: false }),
    [contentHeight, viewport],
  );
  let pinned: ReactNode = null;
  if (flowPin) {
    pinned = (
      <FlowPinnedCopy store={pinStore} top={pinnedTop} left={indexRowLeft} width={indexRowWidth} testID={`${routeId}.pinnedIndex`}>
        {chipIndex}
      </FlowPinnedCopy>
    );
  } else if (layout === 'desktop' && columns) {
    pinned = (
      <>
        {sideIndex ? (
          <Pinned scrollY={header.scrollY} rowTops={scroll.rowTops} anchorKey={firstAfterStage} offset={space[24]} pinnedTop={space[24]} scrollToOffset={scrollPinnedTo} style={{ left: columns.indexX, width: columns.index }} testID={`${routeId}.pinnedIndex`}>
            <LiveSectionIndex store={scroll.current} items={indexItems} onSelect={selectSection} orientation="column" label={t('sections.label')} testID={`${routeId}.sections`} />
          </Pinned>
        ) : (
          <Pinned scrollY={header.scrollY} rowTops={scroll.rowTops} anchorKey="index" offset={space[24]} pinnedTop={0} onHeight={setIndexHeight} scrollToOffset={scrollPinnedTo} style={{ left: columns.galleryX, width: columns.gallery }} testID={`${routeId}.pinnedIndex`}>
            <LiveSectionIndex store={scroll.current} items={indexItems} onSelect={selectSection} orientation="row" label={t('sections.label')} testID={`${routeId}.sections`} />
          </Pinned>
        )}
        <Pinned
          scrollY={header.scrollY}
          rowTops={scroll.rowTops}
          anchorKey={firstAfterStage}
          offset={space[24]}
          pinnedTop={space[24]}
          clampToEnd={{ contentHeight: scroll.contentHeight, bottomGap: space[24] }}
          // DQ-M53R2-02: at 200 % the card can be taller than the window; it then pins by its bottom edge, 24 above the end.
          viewport={scroll.viewport}
          bottomGap={space[24]}
          scrollToOffset={scrollPinnedTo}
          style={{ left: columns.cardX, width: columns.card }}
          testID={`${routeId}.pinnedCard`}
        >
          {/* 10 §5 web desktop: the right sticky card — owner, spec summary, actions (the owner's capsule), sticker preview for the owner. */}
          <DesktopCard vehicle={vehicle} routeId={routeId} onOpenOwner={openOwner} width={columns.card - 2 * space[24]}>
            {summary('card')}
            {/* R6-3: the Build Score inside the side card at 144, not across the content column. */}
            {qaState === 'empty' ? null : <BuildScoreSection vehicle={vehicle} routeId={routeId} part="score" layoutWidth={columns.card - 2 * space[24]} />}
          </DesktopCard>
        </Pinned>
      </>
    );
  } else {
    pinned = (
      <Pinned scrollY={header.scrollY} rowTops={scroll.rowTops} anchorKey="index" pinnedTop={pinnedTop} onHeight={setIndexHeight} scrollToOffset={scrollPinnedTo} style={{ left: indexRowLeft, width: indexRowWidth }} testID={`${routeId}.pinnedIndex`}>
        {chipIndex}
      </Pinned>
    );
  }

  // Every input of a row, so the list draws its rows again exactly when one of them changes (never on a scroll-spy change).
  // Review N5: the language and the report entry too, so switching between DE and EN draws the rows again while the page stays.
  const language = i18n.language;
  const reportLabel = reportable ? report.label : null;
  const extraData = useMemo(
    () => ({ vehicle, layout, width, gutter, measuredIndex, ownerContent, ownerToolbar, capsule, status, sharing, overlap, barHeight, discussions, language, reportLabel, commentsMode }),
    [vehicle, layout, width, gutter, measuredIndex, ownerContent, ownerToolbar, capsule, status, sharing, overlap, barHeight, discussions, language, reportLabel, commentsMode],
  );

  return (
    <SectionHeadingsContext value={headings}>
    <ProfileFrame
      routeId={routeId}
      layout={layout}
      overHero={overHero}
      title={vehicle.title}
      onBack={onBack}
      actions={actions}
      header={header}
      photoCollapseAt={Math.max(0, heroHeight - barHeight)}
      onWidth={setWidth}
      onOverlayHeight={setOverlayHeight}
      offlineLabel={offlineLabel}
      floating={capsuleFloats ? ownerCapsule : undefined}
      pinned={pinned}
      qaSettled={settled}
      scrollToTop={(animated) => {
        scroll.release();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      list={(footer, pinnedInList) => (
        <CollapsingFlashList
          // Web: the pinned blocks ride in the scroller's header, a zero-height box stuck to the scroller's top (CSS sticky), so their
          // places stay viewport-relative as before while the scroller itself clips them and scrolls under a wheel or a touch.
          ListHeaderComponent={pinnedInList ? <>{pinnedInList}</> : undefined}
          ListHeaderComponentStyle={pinnedInList ? PINNED_HEADER_STYLE : undefined}
          ref={listRef}
          data={rows}
          // Reanimated's style on the animated list (the opacity of a reduced-motion jump, DQ-M53-01).
          style={listStyle as StyleProp<ViewStyle>}
          // DQ-M53-04: a QA capture (any qa override, never in production) draws every row at once, so the page measures to its real
          // height before the harness sizes the picture; otherwise rows draw as they come near.
          {...(QA_CAPTURE ? { drawDistance: QA_DRAW_DISTANCE } : {})}
          keyExtractor={keyOf}
          getItemType={typeOf}
          renderItem={renderRow}
          extraData={extraData}
          ListFooterComponent={footer}
          scrollEnabled={!dragging}
          {...header.scrollProps}
          onLoad={() => {
            scroll.listEvents.onLoad();
            openInitial();
          }}
          onContentSizeChange={(w, h) => {
            scroll.listEvents.onContentSizeChange(w, h);
            markSettled(h);
            openInitial();
          }}
          onLayout={scroll.listEvents.onLayout}
          onScrollBeginDrag={scroll.listEvents.onScrollBeginDrag}
          testID={`${routeId}.scroll`}
        />
      )}
      overlays={
        <>
          <PhotoViewer
            photos={photos}
            fallbackAlt={vehicle.full_title}
            index={viewerIndex}
            onClose={() => setViewerIndex(null)}
            // R5-2d: the hero follows the viewer, so closing it on photo 2 shows photo 2, not the one it was opened on.
            onIndexChange={(next) => heroRef.current?.show(next, { animated: false })}
          />
          <MoreSheet
            visible={moreOpen}
            onClose={() => setMoreOpen(false)}
            title={vehicle.full_title}
            actions={moreActions}
            testID={`${routeId}.moreSheet`}
          />
          {compareEnabled ? (
            <ComparePicker
              visible={comparing}
              onClose={() => setComparing(false)}
              current={slug}
              onPick={(other) => {
                setComparing(false);
                router.push({ pathname: '/compare', params: { a: slug, b: other } });
              }}
              testID={`${routeId}.comparePicker`}
            />
          ) : null}
          {commentsMounted && commentsMode !== 'hidden' ? (
            <FeedComments
              visible={commentsOpen}
              onClose={() => setCommentsOpen(false)}
              target={{ type: 'vehicle', id: vehicle.id }}
              vehicleTitle={vehicle.full_title}
              own={ownVehicle}
              enabledByOwner={vehicleCommentsEnabled(vehicle)}
              canWrite={vehicle.comment_thread.can_write}
              routeId={routeId}
            />
          ) : null}
          {report.element}
        </>
      }
    />
    </SectionHeadingsContext>
  );
}
