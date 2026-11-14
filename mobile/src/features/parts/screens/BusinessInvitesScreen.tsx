import '@/features/parts/i18n';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  BUSINESS_CODES,
  dropInvite,
  flattenInvites,
  isBusinessUnavailable,
  isCode,
  useAcceptBusinessInvite,
  useBusinessesOn,
  useBusinessInvites,
  useDeclineBusinessInvite,
  type BusinessInvite,
} from '@/api/queries/businesses';
import { EventPage } from '@/features/events/components/EventPage';
import { photoFields } from '@/features/profile/media';
import { useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import {
  BusinessCard,
  BusinessCardSkeleton,
  Button,
  EmptyState,
  ErrorState,
  GuardedFlashList,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  Text,
  toast,
} from '@/ui';

import { shortDate } from '../components/business/dates';
import { businessCardCover, FALLBACK_COVER, sampleBusiness } from '../model';

const ROUTE = 'BIZ-05';
const SKELETON_ROWS = 2;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  head: { gap: t.space[12], paddingBottom: t.space[8], paddingTop: t.space[16] },
  row: { gap: t.space[12], paddingVertical: t.space[16] },
  meta: { gap: t.space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  state: { paddingTop: t.space[24] },
  more: { minHeight: t.size.touchMin, paddingVertical: t.space[8] },
}));

/**
 * BIZ-05 Einladungen `/business/invites` (SEC-414-01): businesses that invited the member to their team. "Annehmen" joins the team as
 * staff (the member's other invitations end) and opens the Betriebs-Dashboard; "Ablehnen" ends the invitation. A member belongs to
 * one business at most (409 business_exists); a full team answers 409 limit_reached; a gone invitation (404) leaves the list.
 */
export function BusinessInvitesScreen() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const client = useQueryClient();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const flag = useBusinessesOn();
  const requireAuth = useRequireAuth();
  const back = useBack('/business');
  const { gutter } = useBreakpoint();
  const list = useBusinessInvites();
  const accept = useAcceptBusinessInvite();
  const decline = useDeclineBusinessInvite();
  const keys = useRef(new Map<string, string>());
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenInvites(list.data?.pages)), [list.data?.pages, qaState]);
  const restricted = qaState === 'restricted';
  const blocked = restricted || !online;

  const keyFor = (inviteId: string) => {
    const known = keys.current.get(inviteId);
    if (known) return known;
    const next = newIdempotencyKey();
    keys.current.set(inviteId, next);
    return next;
  };

  const onAccept = (invite: BusinessInvite) => {
    const name = invite.business.name;
    accept.mutate(
      { inviteId: invite.id, idempotencyKey: keyFor(invite.id) },
      {
        onSuccess: () => {
          haptics.success();
          toast(t('invites.accepted', { name }), { testID: `${ROUTE}.toast` });
          router.replace('/business');
        },
        onError: (error) => {
          keys.current.delete(invite.id);
          haptics.error();
          let message: string;
          if (isCode(error, BUSINESS_CODES.exists)) message = t('invites.exists');
          else if (isCode(error, BUSINESS_CODES.limitReached)) message = t('invites.full', { name });
          else if (isBusinessUnavailable(error)) {
            dropInvite(client, invite.id);
            message = t('invites.gone');
          } else message = error instanceof ApiError && error.message ? error.message : t('invites.failed');
          toast(message, { testID: `${ROUTE}.toast` });
        },
      },
    );
  };

  const onDecline = (invite: BusinessInvite) => {
    haptics.light();
    decline.mutate(invite.id, {
      onSuccess: () => toast(t('invites.declined'), { testID: `${ROUTE}.toast` }),
      onError: (error) =>
        toast(isBusinessUnavailable(error) ? t('invites.gone') : error instanceof ApiError && error.message ? error.message : t('invites.failed'), {
          haptic: isBusinessUnavailable(error) ? undefined : 'warning',
          testID: `${ROUTE}.toast`,
        }),
    });
  };

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="workshop"
        title={t('dashboard.guestTitle')}
        body={t('dashboard.guestBody')}
        action={{ label: t('apply.signIn'), onPress: () => requireAuth(undefined, { returnTo: '/business/invites' }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (!flag && qaState === 'default') {
    state = <EmptyState icon="workshop" title={t('off.businessesTitle')} body={t('off.businessesBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (qaState === 'loading' || status === 'loading' || (qaState === 'default' && list.isPending && list.fetchStatus !== 'paused')) {
    state = <InvitesSkeleton />;
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
    const sample = sampleBusiness(t);
    state = (
      <EmptyState
        preview={<BusinessCard name={sample.name} subline={sample.subline} services={sample.services} cover={FALLBACK_COVER} sample inert testID={`${ROUTE}.empty.sample`} />}
        title={t('invites.emptyTitle')}
        body={t('invites.emptyBody')}
        action={{ label: t('business.toDiscover'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const header = (
    <View style={[columnStyle, styles.head]}>
      <Text variant="callout" color="text.secondary">
        {t('invites.intro')}
      </Text>
      {restricted ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
          {t('invites.restricted')}
        </Text>
      ) : null}
    </View>
  );

  return (
    <EventPage routeId={ROUTE} title={t('invites.title')} onBack={back} offlineLabel={t('states.offlineBanner')} scroll={false}>
      <GuardedFlashList
        data={state ? [] : rows}
        keyExtractor={(invite: BusinessInvite) => invite.id}
        style={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={state ? <View style={[columnStyle, styles.state]}>{state}</View> : null}
        renderItem={({ item }: { item: BusinessInvite }) => (
          <View style={columnStyle}>
            <InviteRow
              invite={item}
              date={item.created_at ? shortDate(new Date(item.created_at), format.locale) : null}
              accepting={accept.isPending && accept.variables.inviteId === item.id}
              busy={accept.isPending}
              disabled={blocked}
              onOpen={() => router.push({ pathname: '/b/[slug]', params: { slug: item.business.slug } })}
              onAccept={() => onAccept(item)}
              onDecline={() => onDecline(item)}
            />
          </View>
        )}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={[columnStyle, styles.more]}>
              <Spinner label={t('invites.loading')} />
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

type InviteRowProps = {
  invite: BusinessInvite;
  date: string | null;
  accepting: boolean;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onDecline: () => void;
};

/** One invitation: the business as its photo-led card (ADR-457), who invited and when, then Annehmen · Ablehnen. */
function InviteRow({ invite, date, accepting, busy, disabled, onOpen, onAccept, onDecline }: InviteRowProps) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const { business } = invite;
  const cover = businessCardCover(business, layout.feedColumn);
  const meta = [invite.invited_by ? t('invites.invitedBy', { username: invite.invited_by }) : null, date].filter(Boolean).join(' · ');
  return (
    <View style={styles.row} testID={`${ROUTE}.invite.${invite.id}`}>
      <BusinessCard
        name={business.name}
        subline={business.subline}
        services={business.services}
        cover={cover.photo}
        coverNote={cover.symbolic ? t('scope.symbolic') : null}
        logo={business.logo ? photoFields(business.logo, size.avatar.lg) : null}
        verified={business.verified && !business.is_sample}
        sample={business.is_sample}
        onPress={onOpen}
        testID={`${ROUTE}.invite.${invite.id}.business`}
      />
      {meta ? (
        <View style={styles.meta}>
          <Text variant="caption" color="text.secondary" numeric testID={`${ROUTE}.invite.${invite.id}.meta`}>
            {meta}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={t('invites.accept')}
          variant="secondary"
          size="m"
          loading={accepting}
          disabled={disabled || (busy && !accepting)}
          accessibilityLabel={t('invites.acceptLabel', { name: business.name })}
          onPress={onAccept}
          testID={`${ROUTE}.invite.${invite.id}.accept`}
        />
        <Button
          label={t('invites.decline')}
          variant="tertiary"
          size="m"
          disabled={disabled || busy}
          accessibilityLabel={t('invites.declineLabel', { name: business.name })}
          onPress={onDecline}
          testID={`${ROUTE}.invite.${invite.id}.decline`}
        />
      </View>
    </View>
  );
}

/** The list while it loads: the card's geometry (16:9 cover and its text), the meta line and the two buttons. */
function InvitesSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View key={index} style={styles.row}>
          <BusinessCardSkeleton />
          <SkeletonText variant="caption" width="50%" />
          <SkeletonBlock width="55%" height={size.button.m} corner="sm" />
        </View>
      ))}
    </Skeleton>
  );
}
