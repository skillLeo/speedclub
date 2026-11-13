import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { ApiError } from '@/api/client';
import { useBusinessesOn, useDecideModTag, useUntagModBusiness } from '@/api/queries/businesses';
import type { FeedVehicle } from '@/api/queries/home';
import { PRODUCT_RAIL_SIZE, usePartsOn, useProductRail } from '@/api/queries/parts';
import { publicIdOf, type PublicMod } from '@/api/queries/vehicles';
import { SimilarBuildsList } from '@/features/discover/components/SimilarBuildsList';
import { haptics } from '@/lib/haptics';
import { createStyles } from '@/theme';
import { Button, ListRow, StatusPill, Text, toast } from '@/ui';

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  tag: { gap: t.space[8], padding: t.space[16] },
  tagHead: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
}));

type ModLinks = Pick<PublicMod, 'product' | 'installed_by' | 'business_tag' | 'id' | 'brand'>;

/**
 * VEH-02 (09 §7.6 "brand (link) · product (link) · Eingebaut von"): the catalogue product and its brand open BRD-02 and BRD-01; the
 * confirmed business opens BIZ-01. Nothing is drawn while the flags are off or the mod links none of them.
 */
export function ModLinksCard({ mod, routeId, style }: { mod: ModLinks; routeId: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const partsOn = usePartsOn();
  const businessesOn = useBusinessesOn();
  const product = partsOn ? mod.product : null;
  const installed = businessesOn ? mod.installed_by : null;
  if (!product && !installed) return null;
  return (
    <View style={[styles.card, style]} testID={`${routeId}.links`}>
      {product ? (
        <>
          <ListRow
            icon="part-box"
            title={product.full_name}
            subtitle={product.archived ? t('product.archivedLine') : t('mod.product')}
            role="link"
            onPress={() => router.push({ pathname: '/products/[id]', params: { id: product.id } })}
            divider
            testID={`${routeId}.product`}
          />
          <ListRow
            icon="link"
            title={t('mod.brandPage')}
            role="link"
            onPress={() => router.push({ pathname: '/brands/[slug]', params: { slug: product.brand_slug } })}
            divider={installed !== null}
            testID={`${routeId}.brand`}
          />
        </>
      ) : null}
      {installed ? (
        <ListRow
          icon="workshop"
          title={installed.name}
          subtitle={t('mod.installedBy', { city: installed.city })}
          value={installed.verified ? t('mod.verified') : undefined}
          adaptiveValue={false}
          role="link"
          onPress={() => router.push({ pathname: '/b/[slug]', params: { slug: installed.slug } })}
          testID={`${routeId}.installedBy`}
        />
      ) : null}
    </View>
  );
}

/**
 * The owner's view of "Eingebaut von" while it is not settled (ADR-414 double confirmation): a business's proposal waits for
 * "Bestätigen" or "Ablehnen"; the owner's own request waits for the business ("Wartet auf …", which the owner can take back); a
 * declined tag says so and can be removed. An accepted tag is the public link of `ModLinksCard`.
 */
export function OwnerTagPanel({ mod, routeId, style }: { mod: Pick<PublicMod, 'id' | 'business_tag'>; routeId: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const on = useBusinessesOn();
  const decide = useDecideModTag();
  const untag = useUntagModBusiness();
  const tag = mod.business_tag;
  if (!on || !tag || tag.status === 'accepted') return null;
  const proposal = tag.status === 'pending' && tag.initiated_by === 'business';
  const fail = (error: unknown) => toast(error instanceof ApiError ? error.message : t('tags.failed'), { haptic: 'warning', testID: `${routeId}.tagToast` });
  const answer = (decision: 'accepted' | 'declined') => {
    haptics.light();
    decide.mutate(
      { tagId: tag.id, modId: mod.id, decision },
      {
        onSuccess: () => toast(decision === 'accepted' ? t('tags.confirmed', { name: tag.business_name }) : t('tags.declinedByYou'), { testID: `${routeId}.tagToast` }),
        onError: fail,
      },
    );
  };
  const remove = () => untag.mutate(mod.id, { onSuccess: () => toast(t('tags.removed'), { testID: `${routeId}.tagToast` }), onError: fail });
  return (
    <View style={[styles.card, styles.tag, style]} testID={`${routeId}.tag`}>
      <View style={styles.tagHead}>
        <Text variant="headline">{t('mod.installedByTitle')}</Text>
        <StatusPill label={t(`tags.state.${proposal ? 'proposal' : tag.status}`)} testID={`${routeId}.tag.status`} />
      </View>
      <Text variant="body" testID={`${routeId}.tag.text`}>
        {proposal
          ? t('tags.proposalText', { name: tag.business_name })
          : tag.status === 'pending'
            ? t('tags.waitingText', { name: tag.business_name })
            : t('tags.declinedText', { name: tag.business_name })}
      </Text>
      <View style={styles.actions}>
        {proposal ? (
          <>
            <Button label={t('tags.confirm')} variant="secondary" size="s" loading={decide.isPending && decide.variables?.decision === 'accepted'} onPress={() => answer('accepted')} testID={`${routeId}.tag.confirm`} />
            <Button label={t('tags.decline')} variant="tertiary" size="s" loading={decide.isPending && decide.variables?.decision === 'declined'} onPress={() => answer('declined')} testID={`${routeId}.tag.decline`} />
          </>
        ) : (
          <Button label={tag.status === 'pending' ? t('tags.withdraw') : t('tags.remove')} variant="tertiary" size="s" loading={untag.isPending} onPress={remove} testID={`${routeId}.tag.remove`} />
        )}
      </View>
    </View>
  );
}

/**
 * VEH-02 "Builds mit {Produkt}" (DQ-1070, 09 §7.6): the other visible builds that run the same catalogue product, as the discover
 * rail. The build of the page itself is left out; nothing is drawn while it loads, fails or is empty.
 */
export function ProductBuildsRail({ productId, productName, excludeSlug, bleed, testID }: { productId: string | null; productName: string; excludeSlug: string; bleed: number; testID: string }) {
  const { t } = useTranslation('parts');
  const router = useRouter();
  const rail = useProductRail(productId);
  const open = useCallback((vehicle: FeedVehicle) => router.push(`/v/${vehicle.slug}`), [router]);
  const own = publicIdOf(excludeSlug);
  const vehicles = (rail.data ?? []).filter((vehicle) => vehicle.cover && publicIdOf(vehicle.slug) !== own).slice(0, PRODUCT_RAIL_SIZE);
  if (!productId || vehicles.length === 0) return null;
  return (
    <SimilarBuildsList
      title={t('mod.productBuilds', { product: productName })}
      label={t('mod.productBuildsLabel', { product: productName })}
      vehicles={vehicles}
      onOpen={open}
      bleed={bleed}
      testID={testID}
    />
  );
}
