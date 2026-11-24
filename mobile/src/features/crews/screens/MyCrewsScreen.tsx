import { useRouter, type Href } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  CREW_LIMITS,
  flattenPages,
  useCrewsOn,
  useMyCrewInvites,
  useMyCrewRequests,
  useMyCrews,
  useWithdrawCrewRequest,
  type Crew,
  type CrewRequest,
} from '@/api/queries/crews';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { EventPage } from '@/features/events/components/EventPage';
import { useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { GuardedFlashList } from '@/ui/flashListCell';
import { ListRow } from '@/ui/ListRow';
import { RowGroup } from '@/ui/RowGroup';
import { Skeleton } from '@/ui/Skeleton';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { useCrewAccess } from '../access';
import { CrewCardSkeleton, CrewCardView } from '../components/CrewCardView';
import { crewErrorText, crewPath, CREWS_PATH, roleLabel, sampleCrew, tx } from '../model';

const ROUTE = 'CREW-04';

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  head: { gap: t.space[16], paddingBottom: t.space[16], paddingTop: t.space[16] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  card: { paddingBottom: t.space[16] },
  cardMeta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  section: { paddingBottom: t.space[12], paddingTop: t.space[8] },
  state: { paddingTop: t.space[24] },
  skeleton: { gap: t.space[16] },
}));

type Row = { kind: 'crew'; key: string; crew: Crew } | { kind: 'section'; key: string; title: string } | { kind: 'requests'; key: string; rows: CrewRequest[] };

/**
 * CREW-04 Meine Crews `/crews/mine` (11 R4-2.3 "Meine Crews" on the own profile, contract §3 #5, #7): every own crew A–Z with the
 * member's role, also a crew staff hid or removed (it then says what that means and that only its members see it), the member's
 * open requests with "Zurückziehen", the entry to the invitations (CREW-05), and "Crew gründen". The limits (5 crews, 2 founded) are
 * said once, as plain rules.
 */
export function MyCrewsScreen() {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const flag = useCrewsOn();
  const status = useSessionStore((state) => state.status);
  const requireAuth = useRequireAuth();
  const access = useCrewAccess();
  const back = useBack('/profile');
  const { gutter } = useBreakpoint();
  const crews = useMyCrews();
  const requests = useMyCrewRequests();
  const invites = useMyCrewInvites();
  const withdraw = useWithdrawCrewRequest();
  const column = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);

  const own = useMemo(() => (qaState === 'empty' ? [] : (crews.data ?? [])), [crews.data, qaState]);
  const open = useMemo(() => (qaState === 'empty' ? [] : flattenPages(requests.data?.pages, (row) => row.id)), [qaState, requests.data?.pages]);
  const inviteCount = qaState === 'empty' ? 0 : flattenPages(invites.data?.pages, (row) => row.id).length;
  const founded = own.filter((crew) => crew.viewer?.role === 'founder').length;

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = own.map((crew) => ({ kind: 'crew', key: crew.id, crew }));
    if (open.length > 0) {
      list.push({ kind: 'section', key: 'requests.title', title: t('mine.requests') });
      list.push({ kind: 'requests', key: 'requests', rows: open });
    }
    return list;
  }, [open, own, t]);

  const create = () => router.push(`${CREWS_PATH}/new` as Href);
  const atFoundLimit = founded >= CREW_LIMITS.founded || own.length >= CREW_LIMITS.memberships;

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="users"
        title={t('mine.guestTitle')}
        body={t('mine.guestBody')}
        action={{ label: t('mine.signIn'), onPress: () => requireAuth(undefined, { returnTo: `${CREWS_PATH}/mine` }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (!flag && qaState === 'default') {
    state = <EmptyState icon="users" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (qaState === 'loading' || status === 'loading' || (qaState === 'default' && crews.isPending && crews.fetchStatus !== 'paused')) {
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.skeleton}>
          <CrewCardSkeleton />
          <CrewCardSkeleton />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || qaState === 'offline' || (!crews.data && qaState === 'default')) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || crews.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('states.offlineTitle') : t('mine.errorTitle')}
        message={offline ? t('states.offlineBody') : undefined}
        onRetry={() => void crews.refetch()}
        retrying={crews.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state = (
      <EmptyState
        preview={<CrewCardView crew={sampleCrew(t)} inert testID={`${ROUTE}.empty.sample`} />}
        title={t('mine.emptyTitle')}
        body={t('mine.emptyBody')}
        action={{ label: t('mine.find'), onPress: () => router.navigate(CREWS_PATH as Href), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const head =
    status === 'member' ? (
      <View style={[column, styles.head]}>
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.limits`}>
          {t('mine.limits', { memberships: CREW_LIMITS.memberships, founded: CREW_LIMITS.founded })}
        </Text>
        {access.restriction ? <FormNotice tone="info" message={access.restriction} testID={`${ROUTE}.restricted`} /> : null}
        <RowGroup testID={`${ROUTE}.shortcuts`}>
          <ListRow
            icon="envelope-simple"
            title={t('mine.invites')}
            value={inviteCount > 0 ? t('mine.invitesCount', { count: inviteCount, value: format.number(inviteCount) }) : undefined}
            onPress={() => router.push(`${CREWS_PATH}/invites` as Href)}
            inset={space[16]}
            testID={`${ROUTE}.invites`}
          />
        </RowGroup>
        <View style={styles.actions}>
          <Button
            label={t('list.create')}
            icon="plus"
            variant="secondary"
            size="m"
            disabled={atFoundLimit || access.restriction !== null}
            onPress={create}
            testID={`${ROUTE}.create`}
          />
        </View>
        {atFoundLimit ? (
          <Text variant="caption" color="text.secondary" testID={`${ROUTE}.limitReached`}>
            {t('mine.limitReached')}
          </Text>
        ) : null}
      </View>
    ) : null;

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'section') {
      return (
        <View style={[column, styles.section]}>
          <Text variant="title2" role="heading" aria-level={2}>
            {item.title}
          </Text>
        </View>
      );
    }
    if (item.kind === 'requests') {
      return (
        <View style={column}>
          <RowGroup testID={`${ROUTE}.requests`}>
            {item.rows.map((request, index) => (
              <ListRow
                key={request.id}
                title={request.crew.name}
                subtitle={request.created_at ? t('mine.requestedOn', { date: format.relative(new Date(request.created_at)) }) : undefined}
                onPress={() => router.push(crewPath(request.crew.slug) as Href)}
                divider={index < item.rows.length - 1}
                inset={space[16]}
                control={
                  <Button
                    label={t('page.withdrawShort')}
                    variant="tertiary"
                    size="m"
                    disabled={!online || withdraw.isPending}
                    accessibilityLabel={t('mine.withdrawLabel', { name: request.crew.name })}
                    onPress={() =>
                      withdraw.mutate(request.crew.slug, {
                        onSuccess: () => {
                          haptics.light();
                          void requests.refetch();
                          toast(t('page.withdrawn'), { testID: `${ROUTE}.toast` });
                        },
                        onError: (error) => toast(crewErrorText(t, error), { haptic: 'warning', testID: `${ROUTE}.toast` }),
                      })
                    }
                    testID={`${ROUTE}.request.${request.id}.withdraw`}
                  />
                }
                testID={`${ROUTE}.request.${request.id}`}
              />
            ))}
          </RowGroup>
        </View>
      );
    }
    const { crew } = item;
    return (
      <View style={[column, styles.card]} testID={`${ROUTE}.crew.${crew.slug}`}>
        {/* The member's role, open requests and a hidden/removed note belong to the crew: inside its card (R4DQ-30 pattern). */}
        <CrewCardView
          crew={crew}
          onPress={() => router.push(crewPath(crew.slug) as Href)}
          testID={`${ROUTE}.crew.${crew.slug}.card`}
          footer={
            <>
              <View style={styles.cardMeta}>
                {crew.viewer?.role ? <StatusPill label={roleLabel(t, crew.viewer.role)} testID={`${ROUTE}.crew.${crew.slug}.role`} /> : null}
                {(crew.pending_requests_count ?? 0) > 0 ? (
                  <Text variant="caption" color="text.secondary" numeric testID={`${ROUTE}.crew.${crew.slug}.pending`}>
                    {t('mine.pending', { count: crew.pending_requests_count ?? 0, value: format.number(crew.pending_requests_count ?? 0) })}
                  </Text>
                ) : null}
              </View>
              {crew.status !== 'active' ? <FormNotice tone="info" message={tx(t, `mine.status.${crew.status}`)} testID={`${ROUTE}.crew.${crew.slug}.status`} /> : null}
            </>
          }
        />
      </View>
    );
  };

  return (
    <EventPage routeId={ROUTE} title={t('mine.title')} onBack={back} offlineLabel={t('states.offlineBanner')} scroll={false}>
      <GuardedFlashList
        data={state ? [] : rows}
        keyExtractor={(row: Row) => row.key}
        getItemType={(row: Row) => row.kind}
        renderItem={renderItem}
        style={styles.list}
        ListHeaderComponent={head}
        ListEmptyComponent={state ? <View style={[column, styles.state]}>{state}</View> : null}
        testID={`${ROUTE}.list`}
      />
    </EventPage>
  );
}
