import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { BusinessCardData } from '@/api/queries/businesses';
import type { MakeTile } from '@/api/queries/discover';
import type { HomeModules } from '@/api/queries/home';
import { countOf } from '@/api/queries/parts';
import { MakeTiles } from '@/features/discover/components/MakeTiles';
import { businessCardCover } from '@/features/parts/model';
import { photoFields } from '@/features/profile/media';
import { createStyles, size, space } from '@/theme';
import { BusinessCard, SectionHeader } from '@/ui';

export type BrandFocus = HomeModules['brands_in_focus'][number];

/** 09 §7.3 "Marken im Fokus": three BrandTiles. */
export const HOME_BRANDS = 3;
/** "Werkstätten": a rail of up to six cards. */
export const HOME_BUSINESSES = 6;

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  rail: { flexDirection: 'row', gap: t.space[12] },
}));

/** The brands of the module: real counts only (DQ-1140, ADR-457), a brand without a real build left out. */
export function focusBrands(brands: readonly BrandFocus[] | undefined): MakeTile[] {
  return (brands ?? [])
    .map((brand, index) => ({ id: index, slug: brand.slug, name: brand.name, vehicle_count: countOf(brand.vehicle_count) }))
    .filter((tile) => tile.vehicle_count > 0)
    .slice(0, HOME_BRANDS);
}

/** Real businesses first; a module of samples alone would be invented (09 §7.3 "never an empty module"), so it needs one real. */
export function homeBusinesses(rows: readonly BusinessCardData[] | undefined): BusinessCardData[] {
  const list = rows ?? [];
  const real = list.filter((business) => !business.is_sample);
  if (real.length === 0) return [];
  return [...real, ...list.filter((business) => business.is_sample)].slice(0, HOME_BUSINESSES);
}

/** HOME-01 "Marken im Fokus" (09 §7.3, M4.14): three part brands as BrandTiles, each opens BRD-01; "Alle" opens Entdecken › Teile. */
export function BrandsInFocus({ brands, width, routeId }: { brands: readonly MakeTile[]; width: number; routeId: string }) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  return (
    <View testID={`${routeId}.brandsInFocus`}>
      <View style={styles.header}>
        <SectionHeader
          title={t('brands.title')}
          actionLabel={t('brands.all')}
          actionAccessibilityLabel={t('brands.allLabel')}
          onAction={() => router.navigate({ pathname: '/discover', params: { scope: 'parts' } })}
          testID={`${routeId}.brandsInFocus.header`}
        />
      </View>
      <MakeTiles
        makes={brands}
        width={width}
        onOpen={(tile) => router.push({ pathname: '/brands/[slug]', params: { slug: tile.slug } })}
        testID={`${routeId}.brandsInFocus.tiles`}
      />
    </View>
  );
}

/**
 * HOME-01 "Werkstätten" (09 §7.3, M4.14): verified businesses as a BusinessCard rail (cover first, ADR-457), each opens BIZ-01; "Alle"
 * opens Entdecken › Betriebe. Start knows no location, so the module never says "in deiner Nähe".
 */
export function BusinessesRail({ businesses, column, bleed, routeId }: { businesses: readonly BusinessCardData[]; column: number; bleed: number; routeId: string }) {
  const { t } = useTranslation('home');
  const tParts = useTranslation('parts').t;
  const styles = useStyles();
  const router = useRouter();
  const cardWidth = useMemo(() => Math.max(0, Math.min(column - space[48], size.dialogMaxWidth)), [column]);
  return (
    <View testID={`${routeId}.businesses`}>
      <View style={styles.header}>
        <SectionHeader
          title={t('businesses.title')}
          actionLabel={t('businesses.all')}
          actionAccessibilityLabel={t('businesses.allLabel')}
          onAction={() => router.navigate({ pathname: '/discover', params: { scope: 'businesses' } })}
          testID={`${routeId}.businesses.header`}
        />
      </View>
      <View style={{ marginHorizontal: -bleed }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, { paddingHorizontal: bleed }]} role="list" testID={`${routeId}.businesses.rail`}>
          {businesses.map((business) => {
            const cover = businessCardCover(business, cardWidth);
            return (
              <View key={business.id} role="listitem" style={{ width: cardWidth }}>
                <BusinessCard
                  name={business.name}
                  subline={business.subline}
                  services={business.services}
                  cover={cover.photo}
                  coverNote={cover.symbolic ? tParts('scope.symbolic') : null}
                  logo={business.logo ? photoFields(business.logo, size.avatar.lg) : null}
                  verified={business.verified && !business.is_sample}
                  sample={business.is_sample}
                  onPress={() => router.push({ pathname: '/b/[slug]', params: { slug: business.slug } })}
                  testID={`${routeId}.businesses.${business.slug}`}
                />
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
