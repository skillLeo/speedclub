import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCachedPublicVehicle, usePublicMod, type PublicMod, type PublicModRow } from '@/api/queries/vehicles';
import { SearchSimilarButton } from '@/features/discover/components/SearchSimilarButton';
import { ModLinksCard, OwnerTagPanel, ProductBuildsRail } from '@/features/parts/components/ModParts';
import { createStyles, space, useBreakpoint } from '@/theme';
import { Icon, Photo, PressableScale, Skeleton, SkeletonBlock, SkeletonText, SpecRow, StatusPill, Text } from '@/ui';

import { PhotoViewer } from '../components/PhotoViewer';
import { PushedPage } from '../components/PushedPage';
import { GroupHeader, RowCard } from '../components/RowCard';
import { StateScreen } from '../components/StateScreen';
import { photoFields, visiblePhotos } from '../media';
import { useLegalLabel } from '../legal';
import { categoryIcon } from '../model';
import { paramOf, useBack } from '../navigation';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-02';
/** DQ-1070 (09 §7.6 VEH-02): the photos after the hero as a 3-column 1:1 wall, 2 apart, no radius. */
const PHOTO_COLUMNS = 3;
const PHOTO_WIDTH = 320;
const HERO_WIDTH = 1080;
const SKELETON_ROWS = 4;

const useStyles = createStyles((t) => ({
  category: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  // DQ-1070: `title.1` for the part, as a person's name on a profile; the category above it.
  title: { marginTop: t.space[8] },
  hero: { marginBottom: t.space[20] },
  glyphHeader: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.md,
    height: t.space[64],
    justifyContent: 'center',
    marginBottom: t.space[16],
    width: t.space[64],
  },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[12] },
  section: { marginTop: t.space[32] },
  headerToContent: { marginBottom: t.space[12] },
  photoRows: { gap: t.space[2] },
  photoRow: { flexDirection: 'row', gap: t.space[2] },
  photoTile: { flex: 1 },
  photoVisual: { borderRadius: t.radius.none },
  disclaimer: { marginTop: t.space[16] },
  skeletonCard: { marginTop: t.space[32] },
}));

type ModHead = Pick<PublicModRow, 'title' | 'category' | 'status_label' | 'installed_label' | 'legal_status' | 'legal_status_label'>;

/** Category, `title.m` name, status and month: shown from the vehicle's cached row while the detail loads. */
function ModHeader({ mod }: { mod: ModHead }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const legal = useLegalLabel()(mod);
  return (
    <View>
      <View style={styles.category}>
        <Icon name={categoryIcon(mod.category.icon)} size={20} color="text.secondary" />
        <Text variant="callout" color="text.secondary">
          {mod.category.name}
        </Text>
      </View>
      <Text variant="title1" role="heading" {...({ 'aria-level': 1 } as object)} style={styles.title} testID={`${ROUTE_ID}.title`}>
        {mod.title}
      </Text>
      <View style={styles.meta}>
        <StatusPill label={mod.status_label} testID={`${ROUTE_ID}.status`} />
        {/* [SIG] The owner's statement, in the same shape (§8); the disclaimer under the details says so. */}
        {legal ? (
          <View accessible aria-label={`${t('mod.legalStatus')}: ${legal}`}>
            <StatusPill label={legal} testID={`${ROUTE_ID}.legalStatus`} />
          </View>
        ) : null}
        {mod.installed_label ? (
          <Text variant="callout" color="text.secondary">
            {t('mod.installedSince', { date: mod.installed_label })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * DQ-1070 (09 §7.6 VEH-02): the mod's first photo, 4:5 edge to edge on a phone (radius 12 in the tablet and desktop column), which
 * opens the viewer; without a photo a 64 glyph header on `bg.raised`.
 */
function ModHero({ mod, onOpenPhoto }: { mod: PublicMod; onOpenPhoto: (index: number) => void }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const first = visiblePhotos(mod.photos)[0];
  if (!first) {
    return (
      <View style={styles.glyphHeader} testID={`${ROUTE_ID}.glyphHeader`}>
        <Icon name={categoryIcon(mod.category.icon)} size={24} color="text.secondary" />
      </View>
    );
  }
  const phone = kind === 'phone';
  return (
    <PressableScale
      role="button"
      aria-label={t('hero.open', { alt: first.alt || mod.title, current: 1, total: visiblePhotos(mod.photos).length })}
      onPress={() => onOpenPhoto(0)}
      style={[styles.hero, phone ? { marginHorizontal: -gutter } : null]}
      testID={`${ROUTE_ID}.hero`}
    >
      <Photo {...photoFields(first, HERO_WIDTH)} aspect="4:5" corner={phone ? 'none' : 'md'} />
    </PressableScale>
  );
}

/** The common facts under the category table, only those the owner entered and the viewer may see. */
function generalRows(mod: PublicMod, t: (key: string) => string): { key: string; label: string; value: string }[] {
  return [
    mod.brand ? { key: 'brand', label: t('mod.brand'), value: mod.brand } : null,
    mod.part_number ? { key: 'partNumber', label: t('mod.partNumber'), value: mod.part_number } : null,
    // Costs are private and never on a public page (09 §7.6 GAR-10, ADR-436 / lead ruling M4.9: `cost_public` goes away).
  ].filter((row): row is { key: string; label: string; value: string } => row !== null);
}

function ModBody({ mod, slug, onOpenPhoto }: { mod: PublicMod; slug: string; onOpenPhoto: (index: number) => void }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  // The first photo is the hero (ModHero); the wall holds the rest.
  const photos = visiblePhotos(mod.photos).slice(1);
  const specValues = new Set(mod.specs.map((row) => row.value));
  // A category table that already names the brand ("Felgenmarke: Rays") does not repeat it below.
  const general = generalRows(mod, t).filter((row) => row.key !== 'brand' || !specValues.has(row.value));
  const rows: PublicMod['photos'][] = [];
  for (let start = 0; start < photos.length; start += PHOTO_COLUMNS) rows.push(photos.slice(start, start + PHOTO_COLUMNS));

  return (
    <>
      {/* M4.14 (09 §7.6 VEH-02): product and brand (BRD-02, BRD-01), "Eingebaut von" (BIZ-01); the owner sees an unsettled tag. */}
      <ModLinksCard mod={mod} routeId={ROUTE_ID} style={styles.section} />
      <OwnerTagPanel mod={mod} routeId={ROUTE_ID} style={styles.section} />
      {photos.length > 0 ? (
        <View style={[styles.section, styles.photoRows]} testID={`${ROUTE_ID}.photos`}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.photoRow}>
              {row.map((photo, cell) => {
                const index = rowIndex * PHOTO_COLUMNS + cell + 1;
                return (
                  <PressableScale
                    key={photo.id}
                    role="button"
                    aria-label={t('hero.open', { alt: photo.alt || mod.title, current: index + 1, total: photos.length + 1 })}
                    onPress={() => onOpenPhoto(index)}
                    style={styles.photoTile}
                    contentStyle={styles.photoVisual}
                    testID={`${ROUTE_ID}.photo.${index}`}
                  >
                    <Photo {...photoFields(photo, PHOTO_WIDTH)} aspect="1:1" corner="none" />
                  </PressableScale>
                );
              })}
              {row.length < PHOTO_COLUMNS ? <View style={styles.photoTile} /> : null}
            </View>
          ))}
        </View>
      ) : null}
      {mod.specs.length > 0 ? (
        <View style={styles.section} testID={`${ROUTE_ID}.specs`}>
          <GroupHeader title={t('mod.details')} style={styles.headerToContent} />
          <RowCard>
            {mod.specs.map((row, index) => (
              <SpecRow
                key={row.key}
                label={row.label}
                value={row.value}
                divider={index < mod.specs.length - 1}
                inset={space[16]}
                testID={`${ROUTE_ID}.spec.${row.key}`}
              />
            ))}
          </RowCard>
        </View>
      ) : null}
      {general.length > 0 ? (
        <View style={styles.section} testID={`${ROUTE_ID}.general`}>
          <GroupHeader title={t('mod.general')} style={styles.headerToContent} />
          <RowCard>
            {general.map((row, index) => (
              <SpecRow
                key={row.key}
                label={row.label}
                value={row.value}
                divider={index < general.length - 1}
                inset={space[16]}
                testID={`${ROUTE_ID}.general.${row.key}`}
              />
            ))}
          </RowCard>
        </View>
      ) : null}
      {/* 08_LEGAL §7: mods are the owner's statements, the legal status above all. */}
      <Text variant="caption" color="text.tertiary" style={styles.disclaimer} testID={`${ROUTE_ID}.legalDisclaimer`}>
        {mod.legal_disclaimer ?? t('mods.disclaimer')}
      </Text>
      <SearchSimilarButton mod={mod} style={styles.section} testID={`${ROUTE_ID}.searchSimilar`} />
      {/* DQ-1070: "Ähnliche Builds mit {Produkt}", the other visible builds that run the same catalogue product. */}
      {mod.product ? (
        <View style={styles.section}>
          <ProductBuildsRail productId={mod.product.id} productName={mod.product.full_name} excludeSlug={slug} bleed={gutter} testID={`${ROUTE_ID}.productBuilds`} />
        </View>
      ) : null}
    </>
  );
}

function ModBodySkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE_ID}.skeleton`}>
      <View style={styles.skeletonCard}>
        <SkeletonText variant="headline" width="30%" style={styles.headerToContent} />
        <SkeletonBlock width="100%" height={SKELETON_ROWS * space[48]} corner="md" />
      </View>
    </Skeleton>
  );
}

/**
 * VEH-02 /v/[slug]/mods/[modId]: the category's spec table, the mod's photos and the disclaimer of 08_LEGAL §7.
 * "Ähnliche suchen" opens DISC-02 with the mod's own filters (M2.3).
 */
export function ModDetailScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; modId: string }>();
  const slug = paramOf(params.slug) ?? '';
  const modId = paramOf(params.modId) ?? '';
  const vehiclePath = `/v/${slug}` as const;
  const back = useBack(vehiclePath);
  const query = usePublicMod(slug, modId);
  const state = useRouteState(query);
  const cached = useCachedPublicVehicle(slug);
  const row = cached?.mods.groups.flatMap((group) => group.items).find((item) => item.id === modId);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const mod = query.data;
  const head: ModHead | undefined = state === 'ready' ? mod : row;

  if (state === 'loading' && !head) {
    return (
      <PushedPage routeId={ROUTE_ID} onBack={back}>
        <Skeleton testID={`${ROUTE_ID}.headerSkeleton`}>
          <SkeletonText variant="callout" width="40%" />
          <SkeletonText variant="title2" width="70%" style={styles.title} />
        </Skeleton>
        <ModBodySkeleton />
      </PushedPage>
    );
  }
  if (state !== 'loading' && state !== 'ready') {
    return (
      <StateScreen routeId={ROUTE_ID} title={t('mod.screenTitle')} onBack={back}>
        <RouteStateBody
          state={state}
          routeId={ROUTE_ID}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          notFound={{
            title: t('mod.notFoundTitle'),
            body: t('mod.notFoundBody'),
            actionLabel: t('backToVehicle'),
            onAction: () => router.replace(vehiclePath),
          }}
        />
      </StateScreen>
    );
  }

  return (
    <PushedPage
      routeId={ROUTE_ID}
      title={head?.category.name}
      onBack={back}
      overlays={
        mod ? (
          <PhotoViewer photos={visiblePhotos(mod.photos)} fallbackAlt={mod.title} index={viewerIndex} onClose={() => setViewerIndex(null)} />
        ) : null
      }
    >
      {state === 'ready' && mod ? <ModHero mod={mod} onOpenPhoto={setViewerIndex} /> : null}
      {head ? <ModHeader mod={head} /> : null}
      {state === 'ready' && mod ? <ModBody mod={mod} slug={slug} onOpenPhoto={setViewerIndex} /> : <ModBodySkeleton />}
    </PushedPage>
  );
}
