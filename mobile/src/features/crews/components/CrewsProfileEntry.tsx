import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { flattenPages, useCrewsOn, useMyCrewInvites, useMyCrews } from '@/api/queries/crews';
import { useFormat } from '@/lib/useFormat';
import { space } from '@/theme';
import { ListRow } from '@/ui/ListRow';

import { CREWS_PATH } from '../model';

/** True while the own profile shows the "Meine Crews" row (the `crews` flag). */
export function useCrewsEntry(): boolean {
  return useCrewsOn();
}

/**
 * PROF-01 (11 R4-2.3 "Meine Crews" on the own profile): a row of the profile's shortcut group that opens CREW-04; its value names
 * waiting invitations ("1 Einladung"), else how many crews the member is in. The caller draws the group (`divider` when a row follows).
 * CREW-00 uses the same row above its search (R4DQ-17): a navigation row with chevron and count, never a section header.
 */
export function CrewsProfileEntry({ routeId, divider = false, testID }: { routeId: string; divider?: boolean; testID?: string }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const router = useRouter();
  const format = useFormat();
  const on = useCrewsOn();
  const crews = useMyCrews(on);
  const invites = useMyCrewInvites(on);
  if (!on) return null;
  const waiting = flattenPages(invites.data?.pages, (row) => row.id).length;
  const count = crews.data?.length;
  const value =
    waiting > 0
      ? t('mine.invitesCount', { count: waiting, value: format.number(waiting) })
      : count !== undefined && count > 0
        ? format.number(count)
        : undefined;
  return (
    <ListRow
      icon="users"
      title={t('mine.title')}
      value={value}
      onPress={() => router.push(`${CREWS_PATH}/mine` as Href)}
      divider={divider}
      inset={space[16]}
      testID={testID ?? `${routeId}.crews`}
    />
  );
}
