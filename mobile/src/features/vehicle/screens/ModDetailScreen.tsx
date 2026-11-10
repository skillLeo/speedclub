import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCachedPublicVehicle, usePublicMod, type PublicMod, type PublicModRow } from '@/api/queries/vehicles';
import { SearchSimilarButton } from '@/features/discover/components/SearchSimilarButton';
import { createStyles, space } from '@/theme';
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
const PHOTO_COLUMNS = 2;
const PHOTO_WIDTH = 320;
const SKELETON_ROWS = 4;

const useStyles = createStyles((t) => ({
  category: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  title: { marginTop: t.space[8] },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[12] },
  section: { marginTop: t.space[32] },
  headerToContent: { marginBottom: t.space[12] },
  photoRows: { gap: t.space[8] },
  photoRow: { flexDirection: 'row', gap: t.space[8] },
  photoTile: { flex: 1 },
  photoVisual: { borderRadius: t.radius.sm },
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
        <Text variant="supporting" color="text.secondary">
          {mod.category.name}
        </Text>
      </View>
      <Text variant="titleM" role="heading" {...({ 'aria-level': 1 } as object)} style={styles.title} testID={`${ROUTE_ID}.title`}>
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
          <Text variant="supporting" color="text.secondary">
            {t('mod.installedSince', { date: mod.installed_label })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The common facts under the category table, only those the owner entered and the viewer may see. */
function generalRows(mod: PublicMod, t: (key: string) => string): { key: string; label: string; value: string }[] {
  return [
    mod.brand ? { key: 'brand', label: t('mod.brand'), value: mod.brand } : null,
    mod.part_number ? { key: 'partNumber', label: t('mod.partNumber'), value: mod.part_number } : null,
    mod.cost ? { key: 'cost', label: t('mod.cost'), value: mod.cost.label } : null,
  ].filter((row): row is { key: string; label: string; value: string } => row !== null);
}

function ModBody({ mod, onOpenPhoto }: { mod: PublicMod; onOpenPhoto: (index: number) => void }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const photos = visiblePhotos(mod.photos);
  const specValues = new Set(mod.specs.map((row) => row.value));
  // A category table that already names the brand ("Felgenmarke: Rays") does not repeat it below.
  const general = generalRows(mod, t).filter((row) => row.key !== 'brand' || !specValues.has(row.value));
  const rows: PublicMod['photos'][] = [];
  for (let start = 0; start < photos.length; start += PHOTO_COLUMNS) rows.push(photos.slice(start, start + PHOTO_COLUMNS));

  return (
    <>
      {photos.length > 0 ? (
        <View style={[styles.section, styles.photoRows]} testID={`${ROUTE_ID}.photos`}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.photoRow}>
              {row.map((photo, cell) => {
                const index = rowIndex * PHOTO_COLUMNS + cell;
                return (
                  <PressableScale
                    key={photo.id}
                    role="button"
                    aria-label={t('hero.open', { alt: photo.alt || mod.title, current: index + 1, total: photos.length })}
                    onPress={() => onOpenPhoto(index)}
                    style={styles.photoTile}
                    contentStyle={styles.photoVisual}
                    testID={`${ROUTE_ID}.photo.${index}`}
                  >
                    <Photo {...photoFields(photo, PHOTO_WIDTH)} aspect="4:3" corner="sm" />
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
      <Text variant="helper" color="text.tertiary" style={styles.disclaimer} testID={`${ROUTE_ID}.legalDisclaimer`}>
        {mod.legal_disclaimer ?? t('mods.disclaimer')}
      </Text>
      <SearchSimilarButton mod={mod} style={styles.section} testID={`${ROUTE_ID}.searchSimilar`} />
    </>
  );
}

function ModBodySkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE_ID}.skeleton`}>
      <View style={styles.skeletonCard}>
        <SkeletonText variant="titleS" width="30%" style={styles.headerToContent} />
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
          <SkeletonText variant="supporting" width="40%" />
          <SkeletonText variant="titleM" width="70%" style={styles.title} />
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
      {head ? <ModHeader mod={head} /> : null}
      {state === 'ready' && mod ? <ModBody mod={mod} onOpenPhoto={setViewerIndex} /> : <ModBodySkeleton />}
    </PushedPage>
  );
}
