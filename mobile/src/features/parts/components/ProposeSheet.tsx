import '@/features/parts/i18n';

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { BUSINESS_CODES, useProposeBusinessTag } from '@/api/queries/businesses';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { useDebouncedValue } from '@/features/auth/forms';
import { categoryIcon } from '@/features/vehicle/model';
import { createStyles, space } from '@/theme';
import { ModRow, Sheet, Skeleton, SkeletonText, Text, TextInput, toast } from '@/ui';

const TYPING_MS = 400;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[8] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/** "speedclub.de/v/bmw-m3-e46-ab12cd34", "/v/…" or the slug alone: the build's slug, or null. */
export function buildSlugOf(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /\/v\/([a-z0-9-]{3,140})/i.exec(trimmed) ?? /^([a-z0-9-]{3,140})$/i.exec(trimmed);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * BIZ-03 "Build vorschlagen" (09 §8.10, ADR-414 double confirmation): the business pastes the link of a public build it worked on,
 * picks the mod it built, and the build's owner confirms (or declines) it; only then does the build join the portfolio.
 */
export function ProposeSheet({ visible, onClose, routeId }: { visible: boolean; onClose: () => void; routeId: string }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const slug = useDebouncedValue(buildSlugOf(link), TYPING_MS);
  const vehicle = usePublicVehicle(visible && slug ? slug : undefined);
  const propose = useProposeBusinessTag();
  const key = useRef(newIdempotencyKey());
  const testID = `${routeId}.proposeSheet`;
  const mods = vehicle.data?.mods.groups.flatMap((group) => group.items) ?? [];

  const send = (modId: string, title: string) => {
    setError(null);
    propose.mutate(
      { modId, idempotencyKey: key.current },
      {
        onSuccess: () => {
          key.current = newIdempotencyKey();
          setLink('');
          onClose();
          toast(t('propose.sent', { mod: title }), { haptic: 'success', testID: `${routeId}.toast` });
        },
        onError: (failure) => {
          key.current = newIdempotencyKey();
          if (failure instanceof ApiError && failure.code === BUSINESS_CODES.conflict) setError(t('propose.taken'));
          else if (failure instanceof ApiError && failure.code === BUSINESS_CODES.limitReached) setError(t('propose.limit'));
          else setError(failure instanceof ApiError ? failure.message : t('propose.failed'));
        },
      },
    );
  };

  let list;
  if (!slug) {
    list = null;
  } else if (vehicle.isPending && vehicle.fetchStatus !== 'idle') {
    list = (
      <Skeleton testID={`${testID}.skeleton`}>
        <SkeletonText variant="body" lines={3} />
      </Skeleton>
    );
  } else if (!vehicle.data) {
    list = (
      <Text variant="callout" color="text.secondary" testID={`${testID}.notFound`}>
        {t('propose.notFound')}
      </Text>
    );
  } else if (mods.length === 0) {
    list = (
      <Text variant="callout" color="text.secondary" testID={`${testID}.noMods`}>
        {t('propose.noMods', { vehicle: vehicle.data.full_title })}
      </Text>
    );
  } else {
    list = (
      <View style={styles.list} role="list" aria-label={t('propose.pick', { vehicle: vehicle.data.full_title })}>
        {mods.map((mod, index) => (
          <View key={mod.id} role="listitem">
            <ModRow
              icon={categoryIcon(mod.category.icon)}
              name={mod.title}
              values={mod.summary_line}
              onPress={() => send(mod.id, mod.title)}
              divider={index < mods.length - 1}
              inset={space[16]}
              testID={`${testID}.mod.${mod.id}`}
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={t('propose.title')} testID={testID}>
      <View style={styles.body}>
        <Text variant="callout" color="text.secondary">
          {t('propose.intro')}
        </Text>
        <TextInput
          label={t('propose.link')}
          value={link}
          onChangeText={(next) => {
            setLink(next);
            setError(null);
          }}
          placeholder={t('propose.linkPlaceholder')}
          error={error ?? undefined}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          loading={propose.isPending}
          testID={`${testID}.link`}
        />
        {vehicle.data ? (
          <Text variant="headline" testID={`${testID}.vehicle`}>
            {vehicle.data.full_title}
          </Text>
        ) : null}
        {list}
      </View>
    </Sheet>
  );
}
