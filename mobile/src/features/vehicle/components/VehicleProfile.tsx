import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useFlag } from '@/api/queries/appConfig';
import { forgetBlockedMember, useSaveBuild } from '@/api/queries/social';
import { readPublicVehicleNow, type BuildUpdate, type PublicModRow, type PublicVehicle } from '@/api/queries/vehicles';
import { SimilarBuildsStrip } from '@/features/discover/components/SimilarBuildsStrip';
import { newMessageHref } from '@/features/messages/entry';
import { FollowButton } from '@/features/profile/components/FollowButton';
import { useReport } from '@/features/safety/useReport';
import { haptics } from '@/lib/haptics';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout as layoutTokens, space, useBreakpoint } from '@/theme';
import { Button, ContentTabs, toast, type HeaderAction } from '@/ui';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { useViewAsLock } from '@/features/viewAs/useViewAs';

import { DESKTOP_CARD_FLEX, DESKTOP_GALLERY_FLEX, TABLET_COLUMN, useProfileLayout, useSticky } from '../layout';
import { visiblePhotos } from '../media';
import { PROFILE_TABS, type ProfileTab } from '../model';
import { COMPARE_FLAG } from '../compare';
import { SAVE_ICON, SAVED_BUILDS_FLAG } from '../save';
import { SHARE_CARD_FLAG } from '../shareCard';
import { useVehicleShare } from '../share';
import { ComparePicker } from './ComparePicker';
import { DesktopThumbs } from './DesktopThumbs';
import { MoreSheet, type MoreAction } from './MoreSheet';
import { PhotoViewer } from './PhotoViewer';
import { ProfileFrame, useContentWidth, useEstimatedOverlayHeight } from './ProfileFrame';
import { ProfileHero, type ProfileHeroHandle } from './ProfileHero';
import { HistorySection, ModsSection, OverviewSection, SpecsSection } from './ProfileSections';
import { ProfileSummary } from './ProfileSummary';

const HERO_RATIO = 4 / 3;

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
  /** GAR-02 owner-only content, first in Übersicht: completeness hints and the like. */
  ownerContent?: ReactNode;
  /** Controlled content tab, for a route that keeps it in the URL. */
  tab?: ProfileTab;
  onTabChange?: (tab: ProfileTab) => void;
};

const useStyles = createStyles((t) => ({
  summaryPhone: { paddingTop: t.space[20] },
  tabs: { backgroundColor: t.color.bg.canvas, marginTop: t.space[24] },
  panel: { paddingBottom: t.space[32], paddingTop: t.space[24] },
  tabletColumn: { alignSelf: 'center', maxWidth: TABLET_COLUMN, paddingTop: t.space[24], width: '100%' },
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
  tab,
  onTabChange,
}: VehicleProfileProps) {
  const { t } = useTranslation('vehicle');
  const { t: tProfile } = useTranslation('profile');
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

  const current = tab ?? ownTab;
  const slug = vehicle.slug;
  const photos = useMemo(() => visiblePhotos(vehicle.photos), [vehicle.photos]);
  const overHero = layout === 'phone' && photos.length > 0;
  const barHeight = overlayHeight ?? estimatedOverlay;

  const desktopInner = Math.min(width, layoutTokens.contentMax + 2 * space[24]) - 2 * space[24];
  const desktopGallery = ((desktopInner - space[24]) * DESKTOP_GALLERY_FLEX) / (DESKTOP_GALLERY_FLEX + DESKTOP_CARD_FLEX);
  const tabletInner = Math.min(width, TABLET_COLUMN) - 2 * gutter;
  const heroWidth = layout === 'phone' ? width : layout === 'tablet' ? tabletInner : desktopGallery;
  const heroHeight = heroWidth / HERO_RATIO;

  // The tabs stick under the floating bar on a phone, at the top of the scroller under a bar above it everywhere else.
  const sticky = useSticky(header.scrollY, overHero ? barHeight : 0, layout === 'desktop' ? space[24] : 0);
  const cardSticky = useSticky(header.scrollY, space[24]);

  const owner = vehicle.owner;
  const ownVehicle = vehicle.is_owner || Boolean(owner?.is_self);
  // Guests get Folgen and Nachricht, which open the auth-required sheet and come back here. A member follows from the row
  // (M2.1) and writes from it (M2.4) when `can_message` allows it: MSG-03 with this vehicle as the conversation's context.
  const guestContact = Boolean(owner) && !ownVehicle && status !== 'member' && !ownerToolbar;
  const memberFollow = Boolean(owner?.username) && !ownVehicle && status === 'member' && !ownerToolbar;
  const memberMessage = memberFollow && owner?.can_message === true;
  const askToSignIn = () => {
    requireAuth(undefined, { returnTo: pathname });
  };
  const writeLock = useViewAsLock();
  const messageLock = useViewAsLock('messages');
  const writeToOwner = () => router.push(newMessageHref({ to: owner?.username ?? undefined, about: vehicle.slug }));

  let ownerActions: ReactNode;
  // DQ-262: the row is laid out for "✓ Folge ich", its widest state, so following never moves the button under the name.
  let ownerWidestActions: ReactNode;
  if (guestContact) {
    ownerActions = (
      <>
        <Button label={t('actions.follow')} variant="secondary" size="m" onPress={askToSignIn} testID={`${routeId}.ownerRow.follow`} />
        <Button label={t('actions.message')} variant="primary" size="m" onPress={askToSignIn} testID={`${routeId}.ownerRow.message`} />
      </>
    );
  } else if (memberFollow && owner?.username) {
    const messageButton = memberMessage ? (
      <Button label={t('actions.message')} variant="primary" size="m" onPress={writeToOwner} locked={messageLock} testID={`${routeId}.ownerRow.message`} />
    ) : null;
    ownerActions = (
      <>
        <FollowButton
          username={owner.username}
          following={owner.is_following}
          variant="secondary"
          name={owner.display_name || `@${owner.username}`}
          testID={`${routeId}.ownerRow.follow`}
        />
        {messageButton}
      </>
    );
    ownerWidestActions = (
      <>
        <Button label={tProfile('follow.following')} icon="check" variant="secondary" size="m" disabled />
        {memberMessage ? <Button label={t('actions.message')} variant="primary" size="m" disabled /> : null}
      </>
    );
  }
  const openOwner =
    owner?.username && !ownerToolbar
      ? () => (owner.is_self ? router.navigate('/profile') : router.push({ pathname: '/u/[username]', params: { username: owner.username ?? '' } }))
      : undefined;

  // [SIGNATURE sig.saved_builds] The server sends null for a guest, the owner and without the flag; a guest still gets the
  // control, which asks to sign in. Never on your own vehicle.
  const saveFlag = useFlag(SAVED_BUILDS_FLAG);
  const showSave = saveFlag && !ownVehicle && !headerActions && (status !== 'member' || typeof vehicle.is_saved === 'boolean');
  const saved = status === 'member' && vehicle.is_saved === true;
  const client = useQueryClient();
  const save = useSaveBuild(vehicle.id);
  const sendSave = (next: boolean) => {
    haptics.light();
    save.mutate(
      { vehicleId: vehicle.id, save: next },
      {
        onSuccess: () => toast(next ? t('save.saved') : t('save.removed'), { testID: `${routeId}.saveToast` }),
        onError: (error) => toast(error.message || t('save.failed'), { haptic: 'warning', testID: `${routeId}.saveToast` }),
      },
    );
  };
  const toggleSave = () => {
    if (useSessionStore.getState().status === 'member') {
      sendSave(!saved);
      return;
    }
    // A guest wants to save. After sign-in the page is read again as the member: your own build, or one saved already, sends nothing.
    requireAuth(
      () => {
        void readPublicVehicleNow(client, slug)
          .then((fresh) => {
            if (fresh.is_owner || fresh.owner?.is_self || fresh.is_saved !== false) return;
            sendSave(true);
          })
          .catch(() => undefined);
      },
      { returnTo: pathname },
    );
  };

  const actions: readonly HeaderAction[] = headerActions ?? [
    ...(showSave
      ? [{ icon: SAVE_ICON, label: t('actions.save'), onPress: toggleSave, selected: saved, locked: writeLock, testID: `${routeId}.save` } satisfies HeaderAction]
      : []),
    { icon: 'share-network', label: t('actions.share'), onPress: () => void share(vehicle), disabled: sharing, testID: `${routeId}.share` },
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
    header.collapseAt.set(summaryY.current + y + height);
  };
  const trackSummary = (offset: number) => (event: LayoutChangeEvent) => {
    summaryY.current = offset + event.nativeEvent.layout.y;
  };

  const hero = (
    <ProfileHero
      ref={heroRef}
      photos={photos}
      width={heroWidth}
      corner={layout === 'phone' ? 'none' : 'md'}
      vehicleTitle={vehicle.full_title}
      ownerUsername={owner?.username}
      onOpen={setViewerIndex}
      routeId={routeId}
    />
  );

  const summary = (variant: 'page' | 'card') => (
    <ProfileSummary
      vehicle={vehicle}
      routeId={routeId}
      variant={variant}
      ownerActions={ownerActions}
      ownerWidestActions={ownerWidestActions}
      onOpenOwner={openOwner}
      ownerToolbar={ownerToolbar}
      onTitleLayout={onTitleLayout}
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
        closingAction={
          guestContact ? { label: t('actions.messageSend'), onPress: askToSignIn } : memberMessage ? { label: t('actions.messageSend'), onPress: writeToOwner } : null
        }
        showPhotoPreview={layout !== 'desktop'}
        similar={<SimilarBuildsStrip vehicleId={vehicle.id} title={vehicle.full_title} bleed={layout === 'desktop' ? 0 : gutter} testID={`${routeId}.similar`} />}
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
    body = (
      <View style={styles.desktopRow}>
        <View style={styles.desktopGallery}>
          {hero}
          <DesktopThumbs photos={photos} fallbackAlt={vehicle.full_title} onSelect={(index) => heroRef.current?.show(index)} testID={`${routeId}.thumbs`} />
          {tabsBlock}
          {panel}
        </View>
        <View style={styles.desktopAside}>
          <Animated.View style={[styles.card, cardSticky.style]} onLayout={cardSticky.onLayout} testID={`${routeId}.card`}>
            {summary('card')}
          </Animated.View>
        </View>
      </View>
    );
  } else if (layout === 'tablet') {
    body = (
      <View style={[styles.tabletColumn, { paddingHorizontal: gutter }]}>
        {hero}
        <View style={styles.summaryPhone} onLayout={trackSummary(0)}>
          {summary('page')}
        </View>
        {tabsBlock}
        {panel}
      </View>
    );
  } else {
    body = (
      <View>
        {hero}
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
