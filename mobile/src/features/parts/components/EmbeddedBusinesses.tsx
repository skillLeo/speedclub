import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import {
  BUSINESS_KINDS,
  DEFAULT_BUSINESS_FILTERS,
  useBusinessList,
  useMayApply,
  type BusinessCardData,
  type BusinessKind,
} from '@/api/queries/businesses';
import { flattenById } from '@/api/queries/parts';
import { useDebouncedValue } from '@/features/auth/forms';
import { photoFields } from '@/features/profile/media';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size } from '@/theme';
import { BusinessCard, BusinessCardSkeleton, Button, Chip, EmptyState, ErrorState } from '@/ui';

import { distanceLabel, sampleBusiness } from '../model';
import { TYPING_MS } from './EmbeddedParts';

const SKELETON_CARDS = 3;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[16] },
  chips: { flexDirection: 'row', gap: t.space[8] },
  list: { gap: t.space[12] },
  more: { alignSelf: 'flex-start' },
}));

/**
 * DISC-01 scope "Betriebe" (09 §7.5, §8.10): verified businesses as BusinessCards (logo, "Werkstatt · München", services, Verifiziert;
 * the distance when the list knows a point), a kind filter, and what is typed in Entdecken's search narrows them. A member without a
 * business finds "Betrieb anmelden" at the end. Shown only while `businesses` is on.
 */
export function EmbeddedBusinesses({ query: typed, bleed, routeId }: { query: string; bleed: number; routeId: string }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const mayApply = useMayApply();
  const query = useDebouncedValue(typed.trim(), TYPING_MS);
  const [kind, setKind] = useState<BusinessKind | null>(null);
  const id = `${routeId}.businessesScope`;
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const list = useBusinessList({ ...DEFAULT_BUSINESS_FILTERS, q: query, kind }, live);
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenById<BusinessCardData>(list.data?.pages)), [list.data?.pages, qaState]);
  const filtered = kind !== null || query !== '';

  let body;
  if (qaState === 'loading' || (live && list.isPending && list.fetchStatus !== 'paused')) {
    body = (
      <View style={styles.list} testID={`${id}.skeleton`}>
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <BusinessCardSkeleton key={index} />
        ))}
      </View>
    );
  } else if (qaState === 'error' || (!list.data && qaState !== 'empty')) {
    const offline = qaState !== 'error' && (!online || list.fetchStatus === 'paused');
    body = (
      <ErrorState
        title={offline ? t('states.offlineTitle') : t('scope.businessesError')}
        message={offline ? t('states.offlineBody') : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${id}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    const sample = sampleBusiness(t);
    body = (
      <EmptyState
        preview={<BusinessCard name={sample.name} subline={sample.subline} services={sample.services} sample inert testID={`${id}.empty.sample`} />}
        title={filtered ? t('scope.businessesNoMatch') : t('scope.businessesEmptyTitle')}
        body={filtered ? t('scope.businessesNoMatchBody') : t('scope.businessesEmptyBody')}
        action={
          filtered
            ? { label: t('scope.resetFilter'), onPress: () => setKind(null), variant: 'secondary', size: 'm' }
            : mayApply
              ? { label: t('scope.apply'), onPress: () => router.push('/settings/business/apply'), variant: 'secondary', size: 'm' }
              : undefined
        }
        testID={`${id}.empty`}
      />
    );
  } else {
    body = (
      <View role="list" style={styles.list} testID={`${id}.list`}>
        {rows.map((business) => (
          <View key={business.id} role="listitem">
            <BusinessCard
              name={business.name}
              subline={business.subline}
              distance={distanceLabel(business.distance_km, t, (km) => format.distance(km))}
              services={business.services}
              logo={business.logo ? photoFields(business.logo, size.avatar.lg) : null}
              verified={business.verified}
              sample={business.is_sample}
              onPress={() => router.push({ pathname: '/b/[slug]', params: { slug: business.slug } })}
              testID={`${id}.business.${business.slug}`}
            />
          </View>
        ))}
        {list.hasNextPage ? (
          <Button
            label={t('scope.moreBusinesses')}
            variant="secondary"
            size="m"
            loading={list.isFetchingNextPage}
            onPress={() => void list.fetchNextPage()}
            style={styles.more}
            testID={`${id}.more`}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root} testID={id}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -bleed }}
        contentContainerStyle={{ paddingHorizontal: bleed }}
        testID={`${id}.kinds`}
      >
        <View role="radiogroup" aria-label={t('scope.kindLabel')} style={styles.chips}>
          <Chip label={t('scope.allKinds')} selected={kind === null} selectionRole="radio" onPress={() => setKind(null)} testID={`${id}.kind.all`} />
          {BUSINESS_KINDS.filter((value) => value !== 'other').map((value) => (
            <Chip
              key={value}
              label={t(`kinds.${value}`)}
              selected={kind === value}
              selectionRole="radio"
              onPress={() => setKind(kind === value ? null : value)}
              testID={`${id}.kind.${value}`}
            />
          ))}
        </View>
      </ScrollView>
      {body}
      {mayApply && rows.length > 0 ? (
        <Button
          label={t('scope.applyLine')}
          variant="tertiary"
          size="m"
          flush="start"
          onPress={() => router.push('/settings/business/apply')}
          testID={`${id}.apply`}
        />
      ) : null}
    </View>
  );
}
