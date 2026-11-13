import '@/features/parts/i18n';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { BUSINESS_CODES, useBusinessesOn, useBusinessPicker, useTagModBusiness, useUntagModBusiness } from '@/api/queries/businesses';
import type { OwnerMod } from '@/api/queries/mods';
import { usePartsOn, useProductSuggestions, type ProductRowData } from '@/api/queries/parts';
import { useDebouncedValue } from '@/features/auth/forms';
import { PickerField } from '@/features/garage/components/fields';
import { photoFields } from '@/features/profile/media';
import { categoryIcon } from '@/features/vehicle/model';
import { haptics } from '@/lib/haptics';
import { createStyles, size, space } from '@/theme';
import { BusinessCard, Button, ErrorState, ListRow, ProductRow, SearchBar, Sheet, Skeleton, SkeletonText, Text, toast } from '@/ui';

import { TYPING_MS } from './EmbeddedParts';
import { OwnerTagPanel } from './ModParts';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[12], paddingBottom: t.space[8] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  cards: { gap: t.space[8] },
  field: { gap: t.space[8] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
}));

export type ProductValue = { id: string; label: string } | null;

/**
 * GAR-10 "Produkt" (09 §7.6, §8.9): the catalogue product of this part, searched as the member types (eight active products of the
 * mod's category); choosing one links the mod to BRD-02 and fills the brand, "Keine Verknüpfung" unlinks it. Free text stays possible:
 * the category's own fields keep whatever the member wrote. Hidden while `parts_catalogue` is off.
 */
export function ProductField({
  value,
  onChange,
  category,
  disabled,
  routeId,
}: {
  value: ProductValue;
  onChange: (next: ProductValue) => void;
  category: string;
  disabled: boolean;
  routeId: string;
}) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const on = usePartsOn();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), TYPING_MS);
  const suggestions = useProductSuggestions(q, category, on && open);
  if (!on) return null;
  const choose = (product: ProductRowData | null) => {
    haptics.selection();
    onChange(product ? { id: product.id, label: product.full_name } : null);
    setOpen(false);
    setText('');
  };
  const rows = suggestions.data ?? [];
  return (
    <>
      <PickerField
        label={t('editor.product')}
        value={value?.label ?? null}
        placeholder={t('editor.productPlaceholder')}
        onPress={() => setOpen(true)}
        helper={t('editor.productHelper')}
        disabled={disabled}
        testID={`${routeId}.product`}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('editor.productTitle')} testID={`${routeId}.productSheet`}>
        <View style={styles.body}>
          <SearchBar
            value={text}
            onChangeText={setText}
            placeholder={t('editor.productSearch')}
            autoCorrect={false}
            autoCapitalize="none"
            testID={`${routeId}.productSheet.search`}
          />
          {suggestions.isPending && suggestions.fetchStatus !== 'idle' ? (
            <Skeleton testID={`${routeId}.productSheet.skeleton`}>
              <SkeletonText variant="headline" lines={3} />
            </Skeleton>
          ) : suggestions.isError ? (
            <ErrorState title={t('editor.productError')} onRetry={() => void suggestions.refetch()} retrying={suggestions.isFetching} testID={`${routeId}.productSheet.error`} />
          ) : rows.length === 0 ? (
            <Text variant="callout" color="text.secondary" testID={`${routeId}.productSheet.none`}>
              {q ? t('editor.productNone', { query: q }) : t('editor.productNoneAtAll')}
            </Text>
          ) : (
            <View style={styles.list} role="list">
              {rows.map((product, index) => (
                <View key={product.id} role="listitem">
                  <ProductRow
                    icon={categoryIcon(product.category.icon)}
                    brand={product.brand.name}
                    name={product.name}
                    category={product.line ?? product.category.name}
                    onPress={() => choose(product)}
                    divider={index < rows.length - 1}
                    inset={space[16]}
                    testID={`${routeId}.productSheet.product.${product.id}`}
                  />
                </View>
              ))}
            </View>
          )}
          {value ? (
            <Button label={t('editor.productClear')} variant="tertiary" size="m" flush="start" onPress={() => choose(null)} testID={`${routeId}.productSheet.clear`} />
          ) : null}
        </View>
      </Sheet>
    </>
  );
}

/**
 * GAR-10 "Eingebaut von" (09 §7.6, §8.10, ADR-414): the owner names the verified business that installed the part; the business
 * confirms in BIZ-04, and only then does the build appear in its portfolio and the business on VEH-02. A business's own proposal is
 * confirmed or declined here; any tag can be removed. It works on a saved mod only (the request names the mod), and right away, apart
 * from the form's "Speichern". Hidden while `businesses` is off.
 */
export function InstalledByField({ mod, disabled, routeId }: { mod: OwnerMod | undefined; disabled: boolean; routeId: string }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const on = useBusinessesOn();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), TYPING_MS);
  const picker = useBusinessPicker(q, on && open);
  const tagMod = useTagModBusiness();
  const untag = useUntagModBusiness();
  if (!on) return null;
  if (!mod) {
    return (
      <Text variant="callout" color="text.secondary" testID={`${routeId}.installedBy.afterSave`}>
        {t('editor.installedByAfterSave')}
      </Text>
    );
  }
  const tag = mod.business_tag;
  const choose = (slug: string, name: string) => {
    tagMod.mutate(
      { modId: mod.id, business: slug },
      {
        onSuccess: (answer) => {
          setOpen(false);
          setText('');
          haptics.light();
          toast(answer.status === 'accepted' ? t('tags.confirmed', { name }) : t('tags.requested', { name }), { testID: `${routeId}.tagToast` });
        },
        onError: (error) =>
          toast(error instanceof ApiError && error.code === BUSINESS_CODES.notVerified ? t('tags.notVerified') : error instanceof ApiError ? error.message : t('tags.failed'), {
            haptic: 'warning',
            testID: `${routeId}.tagToast`,
          }),
      },
    );
  };
  const rows = picker.data ?? [];

  let current;
  if (tag && tag.status !== 'accepted') {
    current = <OwnerTagPanel mod={mod} routeId={`${routeId}.installedBy`} />;
  } else if (tag || mod.installed_by) {
    const name = mod.installed_by?.name ?? tag?.business_name ?? '';
    current = (
      <View style={styles.field}>
        <ListRow icon="workshop" title={name} subtitle={t('tags.state.accepted')} testID={`${routeId}.installedBy.current`} />
        <View style={styles.actions}>
          <Button
            label={t('tags.remove')}
            variant="tertiary"
            size="s"
            flush="start"
            disabled={disabled}
            loading={untag.isPending}
            onPress={() => untag.mutate(mod.id, { onSuccess: () => toast(t('tags.removed'), { testID: `${routeId}.tagToast` }) })}
            testID={`${routeId}.installedBy.remove`}
          />
        </View>
      </View>
    );
  } else {
    current = (
      <PickerField
        label={t('editor.installedBy')}
        value={null}
        placeholder={t('editor.installedByPlaceholder')}
        onPress={() => setOpen(true)}
        helper={t('editor.installedByHelper')}
        disabled={disabled}
        testID={`${routeId}.installedBy`}
      />
    );
  }

  return (
    <>
      {current}
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('editor.installedByTitle')} testID={`${routeId}.businessSheet`}>
        <View style={styles.body}>
          <Text variant="callout" color="text.secondary">
            {t('editor.installedByIntro')}
          </Text>
          <SearchBar
            value={text}
            onChangeText={setText}
            placeholder={t('editor.installedBySearch')}
            autoCorrect={false}
            testID={`${routeId}.businessSheet.search`}
          />
          {picker.isPending && picker.fetchStatus !== 'idle' ? (
            <Skeleton testID={`${routeId}.businessSheet.skeleton`}>
              <SkeletonText variant="headline" lines={3} />
            </Skeleton>
          ) : picker.isError ? (
            <ErrorState title={t('scope.businessesError')} onRetry={() => void picker.refetch()} retrying={picker.isFetching} testID={`${routeId}.businessSheet.error`} />
          ) : rows.length === 0 ? (
            <Text variant="callout" color="text.secondary" testID={`${routeId}.businessSheet.none`}>
              {t('editor.installedByNone')}
            </Text>
          ) : (
            <View style={styles.cards} role="list">
              {rows.map((business) => (
                <View key={business.id} role="listitem">
                  <BusinessCard
                    name={business.name}
                    subline={business.subline}
                    logo={business.logo ? photoFields(business.logo, size.avatar.lg) : null}
                    verified={business.verified}
                    sample={business.is_sample}
                    onPress={() => choose(business.slug, business.name)}
                    testID={`${routeId}.businessSheet.business.${business.slug}`}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </Sheet>
    </>
  );
}
