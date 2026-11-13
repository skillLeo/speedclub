import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfigKey } from '@/api/queries/appConfig';
import { meKey } from '@/api/queries/auth';
import { memberSettingsKey } from '@/api/queries/settings';
import { queryClient, removePersistedCache } from '@/api/queryClient';
import { Dialog, toast } from '@/ui';

/** What survives "Cache leeren": who is signed in, their settings and app-config. Everything else loads again. */
const KEPT: readonly (readonly string[])[] = [meKey, memberSettingsKey, appConfigKey];

function kept(queryKey: readonly unknown[]): boolean {
  return KEPT.some((key) => key.every((part, index) => queryKey[index] === part));
}

/**
 * SET-01 Daten & Speicher › "Cache leeren" (09 §7.9, §8.12): drops the photos expo-image keeps, the stored pages of the offline
 * cache and every loaded page except the session, the settings and app-config, then loads what is on screen again. Drafts and
 * the outbox are not part of the query cache and stay (unsent work is never thrown away by a tidy-up).
 */
export async function clearAppCache(): Promise<void> {
  await Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
  queryClient.removeQueries({ predicate: (query) => !kept(query.queryKey) });
  await removePersistedCache();
  await queryClient.refetchQueries({ type: 'active' });
}

/** The row's confirm dialog and its action. `ask` opens the dialog; `dialog` is rendered by the list. */
export function useClearCache(testID: string): { ask: () => void; dialog: ReactNode } {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = () => {
    setBusy(true);
    void clearAppCache().finally(() => {
      setBusy(false);
      setOpen(false);
      toast(t('cache.done'), { testID: `${testID}.done` });
    });
  };
  const dialog = (
    <Dialog
      visible={open}
      onClose={busy ? undefined : () => setOpen(false)}
      title={t('cache.title')}
      body={t('cache.body')}
      testID={`${testID}.dialog`}
      actions={[
        { label: t('cache.cancel'), variant: 'secondary', disabled: busy, onPress: () => setOpen(false), testID: `${testID}.dialog.cancel` },
        { label: t('cache.confirm'), variant: 'primary', loading: busy, onPress: confirm, testID: `${testID}.dialog.confirm` },
      ]}
    />
  );
  return { ask: () => setOpen(true), dialog };
}
