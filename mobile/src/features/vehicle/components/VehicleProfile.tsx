import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useFlag } from '@/api/queries/appConfig';
import { forgetBlockedMember } from '@/api/queries/social';
import { type BuildUpdate, type PublicModRow, type PublicVehicle } from '@/api/queries/vehicles';
import { newMessageHref } from '@/features/messages/entry';
import { useReport } from '@/features/safety/useReport';
import { useFormat } from '@/lib/useFormat';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout as layoutTokens, space, useBreakpoint } from '@/theme';
import { ContentTabs, OwnerCapsule, type ContextMenuItem, type HeaderAction, type OwnerCapsuleAction } from '@/ui';
import { StretchyHero } from '@/ui/motion/kit';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { DESKTOP_CARD_FLEX, DESKTOP_GALLERY_FLEX, heroBox, heroIdentityOverlap, heroIdentityWidth, profileSummaryWidth, TABLET_COLUMN, useProfileLayout, useSticky } from '../layout';
import { visiblePhotos } from '../media';
import { PROFILE_TABS, type ProfileTab } from '../model';
import { COMPARE_FLAG } from '../compare';
import { SHARE_CARD_FLAG } from '../shareCard';
import { useVehicleShare } from '../share';
import { ComparePicker } from './ComparePicker';
import { HighlightsRail } from './HighlightsRail';
import { LatestUpdate } from './LatestUpdate';
import { MoreSheet, type MoreAction } from './MoreSheet';
import { PhotoViewer } from './PhotoViewer';
import { ProfileFrame, useContentWidth, useEstimatedOverlayHeight } from './ProfileFrame';
import { ProfileHero, type ProfileHeroHandle } from './ProfileHero';
import { HistorySection, ModsSection, OverviewSection, SpecsSection } from './ProfileSections';
import { ProfileSummary, VehicleIdentity } from './ProfileSummary';
import { SimilarBuilds } from './SimilarBuilds';
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
  /** GAR-02 owner-only content, first in Übersicht: completeness hints and the like. */
  ownerContent?: ReactNode;
  /** When the page's data was read (ms), for the offline line "zuletzt aktualisiert vor 5 Min." (DQ-1068). */
  updatedAt?: number;
  /** Controlled content tab, for a route that keeps it in the URL. */
  tab?: ProfileTab;
  onTabChange?: (tab: ProfileTab) => void;
};

const useStyles = createStyles((t) => ({
  // DQ-1047/1048: the photo fades into the dark stage (every theme, ADR-421 b), the identity on it; full width, at most fullBleedMax.
  stage: { alignSelf: 'center', backgroundColor: t.color.scrim.photoEnd, maxWidth: layoutTokens.fullBleedMax, width: '100%' },
  heroIdentity: { paddingBottom: t.space[24] },
  // On the canvas, so the hero trailing behind at half speed (SM5) slides under it. 24 from the hero to the strip (DQ-1047).
  summaryPhone: { backgroundColor: t.color.bg.canvas, paddingTop: t.space[24] },
  sectionGap: { marginTop: t.space[32] },
  sectionGapBelow: { marginBottom: t.space[32] },
  capsule: { alignSelf: 'flex-start' },
  tabs: { backgroundColor: t.color.bg.canvas, marginTop: t.space[24] },
  panel: { paddingBottom: t.space[32], paddingTop: t.space[24] },
  tabletColumn: { alignSelf: 'center', maxWidth: TABLET_COLUMN, width: '100%' },
  desktopRow: {
    alignItems: 'stretch',
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

/**
 * VEH-01, FS-3: the public build page as one document, and the body of GAR-02 ("public layout + owner toolbar"). See
 * features/vehicle/README.md for the slots. It renders the screen with its header; the route decides the states around
 * it (loading, unavailable, error).
 */
export function VehicleProfile({
  vehicle,
  routeId = 'VEH-01',
  onBack,
  headerActions,
  ownerToolbar,
  ownerContent,
  capsule,
  tab,
  onTabChange,
  updatedAt,
}: VehicleProfileProps) {
  const { t } = useTranslation('vehicle');
  const { t: tMessages } = useTranslation('messages');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const layout = useProfileLayout();
  const { gutter } = useBreakpoint();
  const header = useCollapsingHeader();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const heroRef = useRef<ProfileHeroHandle>(null);
  const summaryY = useRef(0);
  const [width, setWidth] = useContentWidth(layout);
  const estimatedOverlay = useEstimatedOverlayHeight();
  const [overlayHeight, setOverlayHeight] = useState<number | null>(null);
  const [ownTab, setOwnTab] = useState<ProfileTab>(tab ?? 'overview');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const compareEnabled = useFlag(COMPARE_FLAG);
  const shareCardEnabled = useFlag(SHARE_CARD_FLAG);
  const { share, copy, sharing } = useVehicleShare(routeId);

  const format = useFormat();
  const offlineLabel = updatedAt ? t('offline.read', { time: format.relative(new Date(updatedAt)) }) : t('offline.readNoTime');
  const current = tab ?? ownTab;
  const slug = vehicle.slug;
  const photos = useMemo(() => visiblePhotos(vehicle.photos), [vehicle.photos]);
  const overHero = layout === 'phone' && photos.length > 0;
  const barHeight = overlayHeight ?? estimatedOverlay;

  // DQ-1047/1048: the hero at every width (4:5 on a phone, 16:9 across the content from 768) with the identity on its scrim.
  const { width: heroWidth, ratio: heroRatio } = heroBox(layout, width);
  const heroHeight = heroWidth / heroRatio;
  const onPhoto = photos.length > 0;
  const overlap = onPhoto ? heroIdentityOverlap(heroWidth, heroRatio) : 0;

  // The tabs stick under the floating bar on a phone, at the top of the scroller under a bar above it everywhere else.
  // From 768 the tabs' parent starts under the stage (the hero and the identity under it), whose height comes from its layout.
  const [stageHeight, setStageHeight] = useState(0);
  const stageOffset = onPhoto ? stageHeight : heroHeight;
  const sticky = useSticky(header.scrollY, overHero ? barHeight : 0, layout === 'desktop' ? stageOffset + space[24] : layout === 'tablet' ? stageOffset : 0);
  const cardSticky = useSticky(header.scrollY, space[24], stageOffset + space[24]);

  const client = useQueryClient();
  const owner = vehicle.owner;
  const ownVehicle = vehicle.is_owner || Boolean(owner?.is_self);
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
      ? [{ key: 'qr', icon: 'qr-code', label: t('more.qr'), onPress: () => router.push(`/qr/${vehicle.id}`) } satisfies MoreAction]
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

  const changeTab = (next: ProfileTab) => {
    if (tab === undefined) setOwnTab(next);
    onTabChange?.(next);
    // A new tab starts right under the tabs, as long as they are stuck: its content is a different length.
    const point = sticky.stickPoint();
    if (point !== null && header.scrollY.get() > point) scrollRef.current?.scrollTo({ y: point, animated: false });
  };

  const openMod = (mod: PublicModRow) => router.push(`/v/${slug}/mods/${mod.id}`);
  const openUpdate = (update: BuildUpdate) => router.push(`/v/${slug}/updates/${update.id}`);
  const openGallery = () => router.push(`/v/${slug}/gallery`);

  // The bar of a tablet shows the title once the page title has passed under it.
  const onTitleLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    // On the hero the identity starts `overlap` above the photo's bottom edge; without photos it is the summary's first block.
    header.collapseAt.set((onPhoto ? heroHeight - overlap : summaryY.current) + y + height);
  };
  const trackSummary = (offset: number) => (event: LayoutChangeEvent) => {
    summaryY.current = offset + event.nativeEvent.layout.y;
  };

  const heroBody = (
    <ProfileHero
      ref={heroRef}
      photos={photos}
      width={heroWidth}
      corner="none"
      vehicleTitle={vehicle.full_title}
      ownerUsername={owner?.username}
      onOpen={setViewerIndex}
      ratio={heroRatio}
      aspect={layout === 'phone' ? '4:5' : '16:9'}
      identityOverlap={onPhoto ? overlap : undefined}
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
  const stage = onPhoto ? (
    <View style={styles.stage} onLayout={(event) => setStageHeight(event.nativeEvent.layout.height)} testID={`${routeId}.stage`}>
      {hero}
      <VehicleIdentity
        vehicle={vehicle}
        routeId={routeId}
        tone="photo"
        layoutWidth={heroIdentityWidth(layout, width, gutter)}
        onOpenOwner={openOwner}
        onTitleLayout={onTitleLayout}
        headMinHeight={overlap}
        style={[styles.heroIdentity, { marginTop: -overlap, paddingHorizontal: gutter }]}
      />
    </View>
  ) : (
    hero
  );

  // DQ-1049: on phones and tablets the capsule floats above the tab bar (ProfileFrame `floating`); the desktop card keeps it in place.
  const capsuleFloats = layout !== 'desktop';
  // 09 §7.6 (4): visitors get the action row, the owner the capsule (DQ-1062: GAR-02 too, with its own glyph actions).
  // At large text the capsule keeps "Update posten" and the QR glyph; the rest moves into "Mehr" so no label breaks inside a word.
  const capsuleActions = capsule?.actions ?? [
    { key: 'qr', icon: 'qr-code', label: t('actions.qr'), onPress: () => router.push(`/qr/${vehicle.id}`), priority: 0 },
    { key: 'edit', icon: 'pencil-simple', label: t('actions.edit'), onPress: () => router.push(`/garage/${vehicle.id}`), priority: 1 },
    { key: 'mods', icon: 'wrench', label: t('actions.mods'), onPress: () => router.push(`/garage/${vehicle.id}/mods`), priority: 2 },
    { key: 'photos', icon: 'image', label: t('actions.photos'), onPress: () => router.push(`/garage/${vehicle.id}/photos`), priority: 3 },
  ] satisfies OwnerCapsuleAction[];
  const shareItem = { key: 'share', label: t('actions.share'), icon: 'share-network' as const, onSelect: () => void share(vehicle) };
  // DQ-1049 / f2: the capsule keeps the glyphs that fit (by priority) beside the one-line primary and moves the rest into "Mehr",
  // on a phone, at large text and in the desktop's side card alike (OwnerCapsule measures it), so a priority-0 tool never hides.
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
      identity={onPhoto ? 'none' : 'canvas'}
      // N1b: the strip knows its width before its own layout, so its first frame already has its final columns.
      layoutWidth={profileSummaryWidth(layout, width, gutter)}
      onOpenOwner={openOwner}
      actions={actionRow}
      ownerToolbar={ownerToolbar}
      onTitleLayout={onPhoto ? undefined : onTitleLayout}
    />
  );

  const tabsBlock = (
    <Animated.View style={[styles.tabs, sticky.style]} onLayout={sticky.onLayout} testID={`${routeId}.tabBar`}>
      <ContentTabs
        tabs={PROFILE_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
        value={current}
        onChange={changeTab}
        label={t('tabs.label')}
        gutter={layout === 'phone'}
        // DQ-158: from 768 the column has no gutter inside it; "Übersicht" still starts on its text edge.
        bleed={layout !== 'phone'}
        testID={`${routeId}.tabs`}
      />
    </Animated.View>
  );

  const section =
    current === 'overview' ? (
      <OverviewSection
        vehicle={vehicle}
        routeId={routeId}
        ownerContent={ownerContent}
        // DQ-1057: only a guest gets the line ("Melde dich an, um Lukas zu schreiben."); a member writes from the action row.
        closingAction={guestContact ? { label: t('overview.closingSignIn'), onPress: askToSignIn } : null}
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
        latest={
          vehicle.updates[0] ? (
            // DQ-1122: the hero opens on the first photo, so the fallback is the second one and the same frame is not shown twice; with a single photo it is that one (DQ-1054).
            <LatestUpdate update={vehicle.updates[0]} routeId={routeId} onOpen={openUpdate} onShowAll={() => changeTab('history')} fallbackPhoto={photos[1] ?? photos[0] ?? null} />
          ) : undefined
        }
        similar={<SimilarBuilds vehicleId={vehicle.id} title={vehicle.full_title} bleed={layout === 'desktop' ? 0 : gutter} testID={`${routeId}.similar`} />}
        onShowMods={() => changeTab('mods')}
        onOpenGallery={openGallery}
        onOpenPhoto={setViewerIndex}
        onOpenMod={openMod}
      />
    ) : current === 'specs' ? (
      <SpecsSection vehicle={vehicle} routeId={routeId} />
    ) : current === 'mods' ? (
      <ModsSection vehicle={vehicle} routeId={routeId} onOpenMod={openMod} />
    ) : (
      <HistorySection vehicle={vehicle} routeId={routeId} onOpenUpdate={openUpdate} />
    );

  const panel = (
    <View
      role="tabpanel"
      aria-label={t(`tabs.${current}`)}
      style={[styles.panel, layout === 'phone' ? { paddingHorizontal: gutter } : null]}
      testID={`${routeId}.panel.${current}`}
    >
      {section}
    </View>
  );

  let body: ReactNode;
  if (layout === 'desktop') {
    // DQ-1048: the full-width 16:9 hero, then 8 columns (tabs + content) beside the sticky 4-column card (strip, actions).
    body = (
      <View>
        {stage}
        <View style={styles.desktopRow}>
          <View style={styles.desktopGallery}>
            {tabsBlock}
            {panel}
          </View>
          <View style={styles.desktopAside}>
            <Animated.View style={[styles.card, cardSticky.style]} onLayout={cardSticky.onLayout} testID={`${routeId}.card`}>
              {summary('card')}
            </Animated.View>
          </View>
        </View>
      </View>
    );
  } else if (layout === 'tablet') {
    body = (
      <View>
        {stage}
        <View style={[styles.tabletColumn, { paddingHorizontal: gutter }]}>
          <View style={styles.summaryPhone} onLayout={trackSummary(heroHeight)}>
            {summary('page')}
          </View>
          {tabsBlock}
          {panel}
        </View>
      </View>
    );
  } else {
    body = (
      <View>
        {stage}
        <View style={[styles.summaryPhone, { paddingHorizontal: gutter }]} onLayout={trackSummary(0)}>
          {summary('page')}
        </View>
        {tabsBlock}
        {panel}
      </View>
    );
  }

  return (
    <ProfileFrame
      routeId={routeId}
      layout={layout}
      overHero={overHero}
      title={vehicle.title}
      onBack={onBack}
      actions={actions}
      header={header}
      photoCollapseAt={Math.max(0, heroHeight - barHeight)}
      scrollRef={scrollRef}
      onWidth={setWidth}
      onOverlayHeight={setOverlayHeight}
      offlineLabel={offlineLabel}
      floating={capsuleFloats ? ownerCapsule : undefined}
      overlays={
        <>
          <PhotoViewer photos={photos} fallbackAlt={vehicle.full_title} index={viewerIndex} onClose={() => setViewerIndex(null)} />
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
          {report.element}
        </>
      }
    >
      {body}
    </ProfileFrame>
  );
}
