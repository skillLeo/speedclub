import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { newIdempotencyKey } from '@/api/client';
import {
  dropMyInvite,
  flattenPages,
  isCrewUnavailable,
  useAcceptCrewInvite,
  useCrewsOn,
  useDeclineCrewInvite,
  useMyCrewInvites,
  type CrewInvite,
} from '@/api/queries/crews';
import { EventPage } from '@/features/events/components/EventPage';
import { useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { GuardedFlashList } from '@/ui/flashListCell';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { nameInText } from '@/ui/textBreaks';
import { toast } from '@/ui/toast';

import { useCrewAccess } from '../access';
import { CrewCardSkeleton, CrewCardView } from '../components/CrewCardView';
import { FactLine, facts } from '../components/FactLine';
import { crewErrorText, crewPath, CREWS_PATH, sampleCrew } from '../model';

const ROUTE = 'CREW-05';

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  head: { gap: t.space[12], paddingBottom: t.space[8], paddingTop: t.space[16] },
  row: { paddingVertical: t.space[8] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  state: { paddingTop: t.space[24] },
  more: { minHeight: t.size.touchMin, paddingVertical: t.space[8] },
}));

/**
 * CREW-05 Crew-Einladungen `/crews/invites` (contract §3 #6, #22, #23; tap path of an `invited` row, §5): the crews that invited the
 * member, newest first. "Annehmen" joins as a member and opens the crew; "Ablehnen" ends the invitation without a word to the crew
 * (C5). A gone invitation (404, also a block that came between) leaves the list; 409 limit_reached names the limit.
 */
export function CrewInvitesScreen() {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const router = useRouter();
  const client = useQueryClient();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const flag = useCrewsOn();
  const access = useCrewAccess();
  const requireAuth = useRequireAuth();
  const back = useBack(`${CREWS_PATH}/mine` as Href);
  const { gutter } = useBreakpoint();
  const list = useMyCrewInvites();
  const accept = useAcceptCrewInvite();
  const decline = useDeclineCrewInvite();
  const keys = useRef(new Map<string, string>());
  const column = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenPages(list.data?.pages, (row) => row.id)), [list.data?.pages, qaState]);
  const blocked = access.restriction !== null || !online;

  const keyFor = (id: string) => {
    const known = keys.current.get(id);
    if (known) return known;
    const next = newIdempotencyKey();
    keys.current.set(id, next);
    return next;
  };

  const onAccept = (invite: CrewInvite) =>
    accept.mutate(
      { inviteId: invite.id, idempotencyKey: keyFor(invite.id), slug: invite.crew.slug },
      {
        onSuccess: (crew) => {
          haptics.success();
          toast(t('page.joined', { name: crew.name }), { testID: `${ROUTE}.toast` });
          router.push(crewPath(crew.slug) as Href);
        },
        onError: (error) => {
          keys.current.delete(invite.id);
          haptics.error();
          if (isCrewUnavailable(error)) dropMyInvite(client, invite.id);
          toast(isCrewUnavailable(error) ? t('invites.gone') : crewErrorText(t, error), { testID: `${ROUTE}.toast` });
        },
      },
    );
  const onDecline = (invite: CrewInvite) => {
    haptics.light();
    decline.mutate(
      { inviteId: invite.id, slug: invite.crew.slug },
      {
        onSuccess: () => toast(t('invites.declined'), { testID: `${ROUTE}.toast` }),
        onError: (error) => toast(isCrewUnavailable(error) ? t('invites.gone') : crewErrorText(t, error), { testID: `${ROUTE}.toast` }),
      },
    );
  };

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="users"
        title={t('mine.guestTitle')}
        body={t('mine.guestBody')}
        action={{ label: t('mine.signIn'), onPress: () => requireAuth(undefined, { returnTo: `${CREWS_PATH}/invites` }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (!flag && qaState === 'default') {
    state = <EmptyState icon="users" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (qaState === 'loading' || status === 'loading' || (qaState === 'default' && list.isPending && list.fetchStatus !== 'paused')) {
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.row}>
          <CrewCardSkeleton
            footer={
              <>
                <SkeletonText variant="caption" width="50%" />
                <SkeletonBlock width="55%" height={size.button.m} corner="sm" />
              </>
            }
          />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || qaState === 'offline' || (list.isError && rows.length === 0) || (!list.data && qaState === 'default')) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || list.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('states.offlineTitle') : t('invites.errorTitle')}
        message={offline ? t('states.offlineBody') : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state = (
      <EmptyState
        preview={<CrewCardView crew={sampleCrew(t)} inert testID={`${ROUTE}.empty.sample`} />}
        title={t('invites.emptyTitle')}
        body={t('invites.emptyBody')}
        action={{ label: t('mine.find'), onPress: () => router.navigate(CREWS_PATH as Href), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const head = (
    <View style={[column, styles.head]}>
      <Text variant="callout" color="text.secondary">
        {t('invites.intro')}
      </Text>
      {access.restriction ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
          {access.restriction}
        </Text>
      ) : null}
    </View>
  );

  return (
    <EventPage routeId={ROUTE} title={t('invites.title')} onBack={back} offlineLabel={t('states.offlineBanner')} scroll={false}>
      <GuardedFlashList
        data={state ? [] : rows}
        keyExtractor={(row: CrewInvite) => row.id}
        style={styles.list}
        ListHeaderComponent={head}
        ListEmptyComponent={state ? <View style={[column, styles.state]}>{state}</View> : null}
        renderItem={({ item }: { item: CrewInvite }) => {
          const accepting = accept.isPending && accept.variables.inviteId === item.id;
          // R4DQ-44: the handle stays whole (no hyphenation, no break inside it); the line wraps before the "@". Figures only on the date.
          const meta = facts([
            item.invited_by?.username ? { text: t('manage.invitedBy', { username: nameInText(item.invited_by.username) }) } : null,
            item.created_at ? { text: format.relative(new Date(item.created_at)), numeric: true } : null,
          ]);
          return (
            <View style={column}>
              <View style={styles.row} testID={`${ROUTE}.invite.${item.id}`}>
                {/* R4DQ-30: who invited and Annehmen/Ablehnen sit inside the card, under its hairline. */}
                <CrewCardView
                  crew={item.crew}
                  onPress={() => router.push(crewPath(item.crew.slug) as Href)}
                  testID={`${ROUTE}.invite.${item.id}.crew`}
                  footer={
                    <>
                      {meta.length > 0 ? (
                        <FactLine parts={meta} variant="caption" color="text.secondary" hyphenate={false} testID={`${ROUTE}.invite.${item.id}.meta`} />
                      ) : null}
                      <View style={styles.actions}>
                        <Button
                          label={t('invites.accept')}
                          variant="secondary"
                          size="m"
                          loading={accepting}
                          disabled={blocked || (accept.isPending && !accepting)}
                          accessibilityLabel={t('invites.acceptLabel', { name: item.crew.name })}
                          onPress={() => onAccept(item)}
                          testID={`${ROUTE}.invite.${item.id}.accept`}
                        />
                        <Button
                          label={t('invites.decline')}
                          variant="tertiary"
                          size="m"
                          disabled={!online || accepting}
                          accessibilityLabel={t('invites.declineLabel', { name: item.crew.name })}
                          onPress={() => onDecline(item)}
                          testID={`${ROUTE}.invite.${item.id}.decline`}
                        />
                      </View>
                    </>
                  }
                />
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={[column, styles.more]}>
              <Spinner label={t('list.more')} />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage && !list.isError) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID={`${ROUTE}.list`}
      />
    </EventPage>
  );
}
