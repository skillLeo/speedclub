import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { avatarUrlOf } from '@/api/queries/auth';
import { newIdempotencyKey } from '@/api/client';
import {
  flattenPages,
  isCrewUnavailable,
  useApproveCrewRequest,
  useChangeCrewRole,
  useCrew,
  useCrewInvites,
  useCrewMembers,
  useCrewRequests,
  useCrewsOn,
  useDeclineCrewRequest,
  useHandOverCrew,
  useInviteToCrew,
  useRemoveCrewMember,
  useWithdrawCrewInvite,
  type Crew,
  type CrewInvite,
  type CrewMember,
  type CrewRequest,
} from '@/api/queries/crews';
import { applyServerErrors } from '@/features/auth/forms';
import { EventPage } from '@/features/events/components/EventPage';
import { photoFields } from '@/features/profile/media';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { GuardedFlashList } from '@/ui/flashListCell';
import { Hairline } from '@/ui/Hairline';
import { ListRow } from '@/ui/ListRow';
import { MemberRow } from '@/ui/MemberRow';
import { Photo } from '@/ui/Photo';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/Sheet';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

import { useCrewAccess } from '../access';
import { CrewMemberRow, CrewMembersSkeleton } from '../components/CrewMemberRow';
import { crewErrorText, crewPath, CREWS_PATH, memberControls } from '../model';

const ROUTE = 'CREW-03';
/** A username (≤ 40) with the @ a member may type first. */
const USERNAME_INPUT_MAX = 41;

export type ManageTab = 'requests' | 'invites' | 'members';
const TABS: readonly ManageTab[] = ['requests', 'invites', 'members'];

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  head: { gap: t.space[16], paddingBottom: t.space[16], paddingTop: t.space[16] },
  row: { gap: t.space[8], paddingVertical: t.space[8] },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], paddingBottom: t.space[8] },
  invite: { gap: t.space[12] },
  inviteButton: { alignSelf: 'flex-start' },
  state: { paddingTop: t.space[24] },
  footer: { paddingBottom: t.space[32] },
  // R4DQ-19: the crew's name on a line of its own, so no sentence ever breaks inside it.
  crew: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  // R4DQ-39: a circle at every font size: both sides set, never stretched by the wrapped intro beside it.
  logo: { alignSelf: 'flex-start', borderRadius: t.radius.full, height: t.size.avatar.md, overflow: 'hidden', width: t.size.avatar.md },
  // R4DQ-48: the tab's empty state inline, left-aligned on the column, with its one action.
  empty: { alignItems: 'flex-start', gap: t.space[4], paddingTop: t.space[8] },
  emptyAction: { marginTop: t.space[12] },
  crewText: { flex: 1, gap: t.space[2], minWidth: 0 },
}));

export function initialManageTab(value: string | undefined): ManageTab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as ManageTab) : 'requests';
}

/** "@lukas.sc" — a username as typed, without the @ and spaces. */
const inviteSchema = z.object({
  username: z
    .string()
    .transform((value) => value.trim().replace(/^@+/, ''))
    .pipe(z.string().min(2, 'manage.usernameShort').regex(/^[A-Za-z0-9._]{2,40}$/, 'manage.usernameInvalid')),
});
type InviteInput = z.input<typeof inviteSchema>;
type InviteValues = z.output<typeof inviteSchema>;

/**
 * CREW-03 Crew verwalten `/crews/[slug]/manage` (and `/crews/[slug]/requests`, the tap path of a `request_received` row, contract §5),
 * for the founder and the admins (11 R4-2.3, contract §3 #16–#26): Anfragen (Aufnehmen · Ablehnen, the decline is silent), Einladungen
 * (invite by username, withdraw) and Mitglieder as dense rows (remove; promote/demote and hand over the founder role — founder only,
 * R4DQ-20). Deleting the crew lives in CREW-02's danger zone (R4DQ-30). Refusals use contract §8's codes.
 */
export function CrewManageScreen({ tab: routeTab }: { tab?: ManageTab }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const params = useLocalSearchParams<{ slug?: string | string[]; tab?: string }>();
  const slug = (paramOf(params.slug) ?? '').toLowerCase();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const flag = useCrewsOn();
  const back = useBack(crewPath(slug) as Href);
  const crew = useCrew(slug);
  const styles = useStyles();
  const { gutter } = useBreakpoint();

  let state: ReactNode = null;
  if (!flag && qaState === 'default') {
    state = <EmptyState icon="users" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (qaState === 'loading' || (qaState === 'default' && crew.isPending && crew.fetchStatus !== 'paused')) {
    state = <CrewMembersSkeleton rows={4} testID={`${ROUTE}.skeleton`} />;
  } else if (qaState === 'error' || qaState === 'offline' || (!crew.data && !isCrewUnavailable(crew.error))) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || crew.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('states.offlineTitle') : t('page.errorTitle')}
        message={offline ? t('states.offlineBody') : undefined}
        onRetry={() => void crew.refetch()}
        retrying={crew.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (!crew.data || !crew.data.viewer?.can || !(crew.data.viewer.can.approve || crew.data.viewer.can.invite || crew.data.viewer.can.manage_members)) {
    state = (
      <EmptyState
        icon="users"
        title={crew.data ? t('manage.notAllowedTitle') : t('page.notFoundTitle')}
        body={crew.data ? t('manage.notAllowedBody') : t('page.notFoundBody')}
        action={{ label: crew.data ? t('manage.toCrew') : t('page.toCrews'), onPress: () => router.replace((crew.data ? crewPath(crew.data.slug) : CREWS_PATH) as Href), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notAllowed`}
      />
    );
  }

  if (state || !crew.data) {
    return (
      <EventPage routeId={ROUTE} title={t('manage.title')} onBack={back} offlineLabel={t('states.offlineBanner')}>
        <View style={styles.state}>{state}</View>
      </EventPage>
    );
  }
  return <ManageView crew={crew.data} initialTab={routeTab ?? initialManageTab(paramOf(params.tab))} onBack={back} columnPadding={gutter} />;
}

type SheetTarget = { row: CrewMember; name: string } | null;
type Confirm = { kind: 'remove' | 'handOver'; username: string; name: string } | null;

function ManageView({ crew, initialTab, onBack, columnPadding }: { crew: Crew; initialTab: ManageTab; onBack: () => void; columnPadding: number }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const access = useCrewAccess();
  const can = crew.viewer?.can;
  const viewerRole = crew.viewer?.role ?? null;
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const [sheet, setSheet] = useState<SheetTarget>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const keys = useRef(new Map<string, string>());
  const inviteKey = useRef(newIdempotencyKey());

  const requests = useCrewRequests(crew.slug, tab === 'requests' && Boolean(can?.approve));
  const invites = useCrewInvites(crew.slug, tab === 'invites' && Boolean(can?.invite));
  const members = useCrewMembers(crew.slug, tab === 'members');
  const approve = useApproveCrewRequest();
  const decline = useDeclineCrewRequest();
  const invite = useInviteToCrew();
  const withdraw = useWithdrawCrewInvite();
  const remove = useRemoveCrewMember();
  const role = useChangeCrewRole();
  const handOver = useHandOverCrew();
  const writesBlocked = access.restriction !== null || !online;

  const form = useForm<InviteInput, unknown, InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { username: '' } });

  const keyFor = (id: string) => {
    const known = keys.current.get(id);
    if (known) return known;
    const next = newIdempotencyKey();
    keys.current.set(id, next);
    return next;
  };
  const failed = (error: unknown) => {
    haptics.error();
    toast(crewErrorText(t, error), { testID: `${ROUTE}.toast` });
  };
  const done = (message: string) => {
    haptics.success();
    toast(message, { testID: `${ROUTE}.toast` });
  };

  const onApprove = (request: CrewRequest) =>
    approve.mutate(
      { slug: crew.slug, requestId: request.id, idempotencyKey: keyFor(request.id) },
      {
        onSuccess: () => done(t('manage.approved', { username: request.member.username ?? '' })),
        onError: (error) => {
          keys.current.delete(request.id);
          failed(error);
        },
      },
    );
  const onDecline = (request: CrewRequest) => {
    haptics.light();
    decline.mutate({ slug: crew.slug, requestId: request.id }, { onSuccess: () => toast(t('manage.declined'), { testID: `${ROUTE}.toast` }), onError: failed });
  };
  const onInvite = () =>
    form.handleSubmit(
    (values) =>
      invite.mutate(
        { slug: crew.slug, username: values.username, idempotencyKey: inviteKey.current },
        {
          onSuccess: () => {
            inviteKey.current = newIdempotencyKey();
            form.reset({ username: '' });
            done(t('manage.invited', { username: values.username }));
          },
          onError: (error) => {
            inviteKey.current = newIdempotencyKey();
            haptics.error();
            const left = applyServerErrors(error, form.setError, { username: 'username' });
            if (left !== null) toast(crewErrorText(t, error), { testID: `${ROUTE}.toast` });
          },
        },
      ),
    () => haptics.warning(),
  )();
  const onWithdraw = (row: CrewInvite) => {
    haptics.light();
    withdraw.mutate({ slug: crew.slug, inviteId: row.id }, { onSuccess: () => toast(t('manage.inviteWithdrawn'), { testID: `${ROUTE}.toast` }), onError: failed });
  };
  const onRole = (target: CrewMember, next: 'admin' | 'member') => {
    setSheet(null);
    role.mutate({ slug: crew.slug, username: target.member.username ?? '', role: next }, { onSuccess: () => done(next === 'admin' ? t('manage.promoted') : t('manage.demoted')), onError: failed });
  };
  const onConfirm = () => {
    if (!confirm) return;
    const { kind, username } = confirm;
    if (kind === 'remove') {
      remove.mutate({ slug: crew.slug, username }, { onSuccess: () => done(t('manage.removed', { username })), onError: failed, onSettled: () => setConfirm(null) });
    } else {
      handOver.mutate(
        { slug: crew.slug, username },
        {
          onSuccess: () => {
            done(t('manage.handedOver', { username }));
            router.replace(crewPath(crew.slug) as Href);
          },
          onError: failed,
          onSettled: () => setConfirm(null),
        },
      );
    }
  };
  const tabs = TABS.filter((entry) => (entry === 'requests' ? can?.approve : entry === 'invites' ? can?.invite : true));
  const current = tabs.includes(tab) ? tab : (tabs[0] ?? 'members');
  const column = [styles.column, { paddingHorizontal: columnPadding }];

  type Row = { key: string; kind: ManageTab; request?: CrewRequest; invite?: CrewInvite; member?: CrewMember };
  const rows: Row[] =
    qaState === 'empty'
      ? []
      : current === 'requests'
        ? flattenPages(requests.data?.pages, (row) => row.id).map((request) => ({ key: request.id, kind: 'requests', request }))
        : current === 'invites'
          ? flattenPages(invites.data?.pages, (row) => row.id).map((row) => ({ key: row.id, kind: 'invites', invite: row }))
          : flattenPages(members.data?.pages, (row) => row.member.username ?? row.joined_at).map((member) => ({ key: member.member.username ?? member.joined_at, kind: 'members', member }));
  const active = current === 'requests' ? requests : current === 'invites' ? invites : members;

  let state: ReactNode = null;
  if (qaState === 'loading' || (active.isPending && active.fetchStatus !== 'paused')) {
    state = <CrewMembersSkeleton testID={`${ROUTE}.${current}.skeleton`} />;
  } else if (active.isError && rows.length === 0) {
    state = <ErrorState title={t('manage.listError')} onRetry={() => void active.refetch()} retrying={active.isFetching} testID={`${ROUTE}.${current}.error`} />;
  } else if (rows.length === 0) {
    // The invitations tab has its form right above; the other two lead there when the viewer may invite.
    const toInvites = current !== 'invites' && tabs.includes('invites');
    state = (
      <View style={styles.empty} testID={`${ROUTE}.${current}.empty`}>
        <Text variant="headline">{t(`manage.empty.${current}Title`)}</Text>
        <Text variant="callout" color="text.secondary">
          {t(`manage.empty.${current}Body`)}
        </Text>
        {toInvites ? (
          <Button
            label={t('manage.inviteSomeone')}
            variant="secondary"
            size="m"
            icon="user-plus"
            onPress={() => setTab('invites')}
            style={styles.emptyAction}
            testID={`${ROUTE}.${current}.empty.invite`}
          />
        ) : null}
      </View>
    );
  }

  const segments = tabs.map((value) => ({
    value,
    label: value === 'requests' && (crew.pending_requests_count ?? 0) > 0 ? t('manage.tabs.requestsCount', { count: crew.pending_requests_count ?? 0, value: format.number(crew.pending_requests_count ?? 0) }) : t(`manage.tabs.${value}`),
    testID: `${ROUTE}.tab.${value}`,
  }));

  const head = (
    <View style={[column, styles.head]}>
      <View style={styles.crew} testID={`${ROUTE}.crew`}>
        {crew.logo ? (
          <Photo {...photoFields(crew.logo, size.avatar.md)} aspect="1:1" corner="full" style={styles.logo} />
        ) : (
          <Avatar name={crew.name} size={size.avatar.md} decorative style={styles.logo} />
        )}
        <View style={styles.crewText}>
          <Text variant="headline" testID={`${ROUTE}.crewName`}>
            {crew.name}
          </Text>
          <Text variant="callout" color="text.secondary">
            {t('manage.intro')}
          </Text>
        </View>
      </View>
      {access.restriction ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
          {access.restriction}
        </Text>
      ) : null}
      {segments.length > 1 ? (
        <SegmentedControl<ManageTab>
          options={segments as unknown as Parameters<typeof SegmentedControl<ManageTab>>[0]['options']}
          value={current}
          onChange={setTab}
          label={t('manage.tabsLabel')}
          role="tablist"
          testID={`${ROUTE}.tabs`}
        />
      ) : null}
      {current === 'invites' ? (
        <View style={styles.invite} testID={`${ROUTE}.inviteForm`}>
          <Controller
            control={form.control}
            name="username"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                label={t('manage.username')}
                placeholder={t('manage.usernamePlaceholder')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={USERNAME_INPUT_MAX}
                helper={fieldState.error ? undefined : t('manage.usernameHelper')}
                error={fieldState.error?.message ? (fieldState.error.type === 'server' ? fieldState.error.message : t(fieldState.error.message as 'manage.usernameShort')) : undefined}
                disabled={writesBlocked}
                onSubmitEditing={() => void onInvite()}
                testID={`${ROUTE}.username`}
              />
            )}
          />
          <Button
            label={t('manage.invite')}
            variant="secondary"
            size="m"
            icon="user-plus"
            loading={invite.isPending}
            disabled={writesBlocked}
            onPress={() => void onInvite()}
            style={styles.inviteButton}
            testID={`${ROUTE}.inviteSend`}
          />
        </View>
      ) : null}
    </View>
  );

  const footer = <View style={[column, styles.footer]}>{active.isFetchingNextPage ? <Spinner label={t('list.more')} /> : null}</View>;

  const renderRow = ({ item, index }: { item: Row; index: number }) => {
    const divider = index > 0 ? <Hairline /> : null;
    if (item.request) {
      const request = item.request;
      const username = request.member.username ?? '';
      const name = request.member.display_name || `@${username}`;
      const meta = [request.member.display_name ? `@${username}` : null, request.created_at ? format.relative(new Date(request.created_at)) : null].filter(Boolean).join(' · ');
      const approving = approve.isPending && approve.variables.requestId === request.id;
      return (
        <View style={column}>
          {divider}
          <View style={styles.row} testID={`${ROUTE}.request.${request.id}`}>
            <MemberRow name={name} meta={meta} avatarUri={avatarUrlOf(request.member.avatar)} avatarBlurhash={request.member.avatar?.blurhash} sample={request.member} inset={0} onPress={username ? () => router.push(`/u/${username}` as Href) : undefined} />
            <View style={styles.rowActions}>
              <Button label={t('manage.approve')} variant="secondary" size="m" loading={approving} disabled={writesBlocked || approve.isPending} accessibilityLabel={t('manage.approveLabel', { name })} onPress={() => onApprove(request)} testID={`${ROUTE}.request.${request.id}.approve`} />
              <Button label={t('manage.decline')} variant="tertiary" size="m" disabled={!online || approving} accessibilityLabel={t('manage.declineLabel', { name })} onPress={() => onDecline(request)} testID={`${ROUTE}.request.${request.id}.decline`} />
            </View>
          </View>
        </View>
      );
    }
    if (item.invite) {
      const row = item.invite;
      const username = row.member.username ?? '';
      const name = row.member.display_name || `@${username}`;
      const meta = [
        row.member.display_name ? `@${username}` : null,
        row.invited_by?.username ? t('manage.invitedBy', { username: row.invited_by.username }) : null,
        row.created_at ? format.relative(new Date(row.created_at)) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return (
        <View style={column}>
          {divider}
          <View style={styles.row} testID={`${ROUTE}.invite.${row.id}`}>
            <MemberRow
              name={name}
              meta={meta}
              avatarUri={avatarUrlOf(row.member.avatar)}
              avatarBlurhash={row.member.avatar?.blurhash}
              sample={row.member}
              inset={0}
              trailing={<Button label={t('manage.withdraw')} variant="tertiary" size="m" disabled={!online} accessibilityLabel={t('manage.withdrawLabel', { name })} onPress={() => onWithdraw(row)} testID={`${ROUTE}.invite.${row.id}.withdraw`} />}
            />
          </View>
        </View>
      );
    }
    const member = item.member as CrewMember;
    const controls = memberControls(viewerRole, member);
    const any = controls.remove || controls.promote || controls.demote || controls.handOver;
    const name = member.member.display_name || `@${member.member.username ?? ''}`;
    return (
      <View style={column}>
        {divider}
        <CrewMemberRow
          row={member}
          selfLabel={t('page.you')}
          onOpenMember={(username) => router.push(`/u/${username}` as Href)}
          onOpenVehicle={(vehicleSlug) => router.push(`/v/${vehicleSlug}` as Href)}
          onManage={any && can?.manage_members ? () => setSheet({ row: member, name }) : undefined}
          compact
          inheritSample={crew.is_sample}
          testID={`${ROUTE}.member.${member.member.username ?? index}`}
        />
      </View>
    );
  };

  const target = sheet?.row;
  const targetControls = target ? memberControls(viewerRole, target) : null;
  const targetUsername = target?.member.username ?? '';

  return (
    <EventPage routeId={ROUTE} title={t('manage.title')} onBack={onBack} offlineLabel={t('states.offlineBanner')} scroll={false}>
      <GuardedFlashList
        data={state ? [] : rows}
        keyExtractor={(row: Row) => `${row.kind}.${row.key}`}
        getItemType={(row: Row) => row.kind}
        renderItem={renderRow}
        style={styles.list}
        ListHeaderComponent={head}
        ListEmptyComponent={state ? <View style={[column, styles.state]}>{state}</View> : null}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (active.hasNextPage && !active.isFetchingNextPage && !active.isError) void active.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID={`${ROUTE}.list`}
      />
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} title={sheet?.name ?? ''} expandable={false} narrow testID={`${ROUTE}.memberSheet`}>
        {targetControls?.promote ? (
          <ListRow icon="shield-check" title={t('manage.promote')} role="button" chevron={false} disabled={writesBlocked} onPress={() => target && onRole(target, 'admin')} testID={`${ROUTE}.memberSheet.promote`} />
        ) : null}
        {targetControls?.demote ? (
          <ListRow icon="user" title={t('manage.demote')} role="button" chevron={false} disabled={!online} onPress={() => target && onRole(target, 'member')} testID={`${ROUTE}.memberSheet.demote`} />
        ) : null}
        {targetControls?.handOver && can?.hand_over ? (
          <ListRow
            icon="arrows-left-right"
            title={t('manage.handOver')}
            role="button"
            chevron={false}
            disabled={!online}
            onPress={() => {
              setSheet(null);
              setConfirm({ kind: 'handOver', username: targetUsername, name: sheet?.name ?? '' });
            }}
            testID={`${ROUTE}.memberSheet.handOver`}
          />
        ) : null}
        {targetControls?.remove ? (
          <ListRow
            icon="sign-out"
            title={t('manage.remove')}
            role="button"
            chevron={false}
            destructive
            disabled={!online}
            onPress={() => {
              setSheet(null);
              setConfirm({ kind: 'remove', username: targetUsername, name: sheet?.name ?? '' });
            }}
            testID={`${ROUTE}.memberSheet.remove`}
          />
        ) : null}
      </Sheet>
      <Dialog
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'handOver' ? t('manage.handOverTitle', { name: confirm.name }) : t('manage.removeTitle', { name: confirm?.name ?? '' })}
        body={confirm?.kind === 'handOver' ? t('manage.handOverBody') : t('manage.removeBody')}
        actions={[
          {
            label: confirm?.kind === 'handOver' ? t('manage.handOverConfirm') : t('manage.removeConfirm'),
            onPress: onConfirm,
            destructive: confirm?.kind === 'remove',
            loading: remove.isPending || handOver.isPending,
            testID: `${ROUTE}.confirm.ok`,
          },
          { label: t('cancel'), onPress: () => setConfirm(null), variant: 'tertiary', testID: `${ROUTE}.confirm.cancel` },
        ]}
        testID={`${ROUTE}.confirm`}
      />
    </EventPage>
  );
}
