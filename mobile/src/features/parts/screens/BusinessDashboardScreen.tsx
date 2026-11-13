import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  BUSINESS_CODES,
  BUSINESS_LIMITS,
  hasNoBusiness,
  useAddTeamMember,
  useBusinessesOn,
  useMyBusiness,
  usePortfolio,
  useRemoveTeamMember,
  type MyBusiness,
} from '@/api/queries/businesses';
import { flattenById, countOf } from '@/api/queries/parts';
import { WALL_COLUMNS_BY_KIND, useDiscoverColumn } from '@/features/discover/layout';
import { GroupHeader, RowCard } from '@/features/vehicle/components/RowCard';
import { useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, space, useBreakpoint } from '@/theme';
import {
  BusinessCard,
  Button,
  Dialog,
  EmptyState,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  StatusPill,
  Text,
  TextInput,
  toast,
} from '@/ui';

import { BuildsWall } from '../components/BuildsWall';
import { PageStateBody } from '../components/PageStates';
import { PartsPage } from '../components/PartsPage';
import { ProposeSheet } from '../components/ProposeSheet';
import { sampleBusiness } from '../model';

const ROUTE = 'BIZ-03';
const USERNAME = /^@?([A-Za-z0-9._]{1,40})$/;

const useStyles = createStyles((t) => ({
  column: { gap: t.space[32], paddingTop: t.space[16] },
  head: { gap: t.space[8] },
  stats: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[4], padding: t.space[20] },
  section: { gap: t.space[12] },
  actions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  sheet: { gap: t.space[16], paddingBottom: t.space[8] },
  states: { paddingTop: t.space[16] },
}));

/**
 * BIZ-03 Betriebs-Dashboard `/business` (09 §7.11, §8.10): the business with its status (and the staff's reason), the private
 * 30-day profile views in tabular figures, "Profil ansehen" / "Profil bearbeiten" / "Anfragen" (with the open count), the portfolio
 * ("Build vorschlagen": the business names a mod it built, the owner confirms) and the team (the owner adds @username as staff and
 * removes them; staff can leave).
 */
export function BusinessDashboardScreen() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const flag = useBusinessesOn();
  const requireAuth = useRequireAuth();
  const back = useBack('/settings');
  const column = useDiscoverColumn();
  const mine = useMyBusiness();
  const none = qaState === 'empty' || hasNoBusiness(mine.error);
  const business = qaState === 'empty' || qaState === 'loading' || qaState === 'error' ? undefined : mine.data;

  let content;
  if (status === 'guest') {
    content = (
      <EmptyState
        icon="workshop"
        title={t('dashboard.guestTitle')}
        body={t('dashboard.guestBody')}
        action={{ label: t('apply.signIn'), onPress: () => requireAuth(undefined, { returnTo: '/business' }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (!flag && qaState === 'default') {
    content = <PageStateBody state="off" routeId={ROUTE} icon="workshop" area="businesses" notFound={NOT_USED} errorTitle="" onRetry={noop} retrying={false} />;
  } else if (business) {
    return <Dashboard business={business} onBack={back} restricted={qaState === 'restricted'} />;
  } else if (none) {
    content = (
      <EmptyState
        preview={<BusinessCard {...sampleCardProps(t)} sample inert testID={`${ROUTE}.empty.sample`} />}
        title={t('dashboard.emptyTitle')}
        body={t('dashboard.emptyBody')}
        action={{ label: t('dashboard.apply'), onPress: () => router.push('/settings/business/apply') }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else if (qaState === 'loading' || status === 'loading' || (mine.isPending && mine.fetchStatus !== 'paused')) {
    content = <DashboardSkeleton />;
  } else {
    const offline = qaState !== 'error' && (!online || mine.fetchStatus === 'paused');
    content = (
      <PageStateBody
        state={offline ? 'offline' : 'error'}
        routeId={ROUTE}
        icon="workshop"
        area="businesses"
        notFound={NOT_USED}
        errorTitle={t('dashboard.errorTitle')}
        error={mine.error}
        onRetry={() => void mine.refetch()}
        retrying={mine.isFetching}
      />
    );
  }
  return (
    <PartsPage routeId={ROUTE} title={t('dashboard.title')} onBack={back} offlineLabel={t('states.offlineBanner')}>
      {() => <View style={[column.style, styles.column, styles.states]}>{content}</View>}
    </PartsPage>
  );
}

const noop = () => undefined;
const NOT_USED = { title: '', body: '', actionLabel: '', onAction: noop };

function sampleCardProps(t: Parameters<typeof sampleBusiness>[0]) {
  const sample = sampleBusiness(t);
  return { name: sample.name, subline: sample.subline, services: sample.services };
}

function DashboardSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.column}>
        <View style={styles.head}>
          <SkeletonText variant="title1" width="60%" />
          <SkeletonText variant="callout" width="40%" />
        </View>
        <SkeletonBlock width="100%" height={size.row.withThumb + space[40]} corner="md" />
        <SkeletonBlock width="100%" height={3 * size.row.single} corner="md" />
      </View>
    </Skeleton>
  );
}

function Dashboard({ business, onBack, restricted }: { business: MyBusiness; onBack: () => void; restricted: boolean }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const column = useDiscoverColumn();
  const { width, kind } = useBreakpoint();
  const own = useSessionStore((state) => state.member?.username?.toLowerCase() ?? null);
  const verified = business.status === 'verified';
  const portfolio = usePortfolio(business.slug, verified);
  const builds = useMemo(() => flattenById(portfolio.data?.pages).filter((vehicle) => vehicle.cover), [portfolio.data?.pages]);
  const owner = business.viewer_role === 'owner';
  const views = countOf(business.views_30d);
  const reason = typeof business.status_reason === 'string' && business.status_reason.trim() ? business.status_reason.trim() : null;
  const [adding, setAdding] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useRemoveTeamMember();
  const phone = kind === 'phone';

  const leave = removing !== null && removing === own;
  const confirmRemove = () => {
    if (!removing) return;
    const username = removing;
    setRemoving(null);
    remove.mutate(username, {
      onSuccess: () => {
        toast(username === own ? t('team.left') : t('team.removed', { username }), { testID: `${ROUTE}.toast` });
        if (username === own) router.replace('/settings');
      },
      onError: (error) => toast(error instanceof ApiError ? error.message : t('team.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
    });
  };

  return (
    <PartsPage
      routeId={ROUTE}
      title={business.name}
      onBack={onBack}
      offlineLabel={t('states.offlineBanner')}
      overlays={
        <>
          {owner ? <AddMemberSheet visible={adding} onClose={() => setAdding(false)} count={business.team.length} /> : null}
          {verified ? <ProposeSheet visible={proposing} onClose={() => setProposing(false)} routeId={ROUTE} /> : null}
          <Dialog
            visible={removing !== null}
            onClose={() => setRemoving(null)}
            title={leave ? t('team.leaveTitle') : t('team.removeTitle', { username: removing ?? '' })}
            body={leave ? t('team.leaveBody', { name: business.name }) : t('team.removeBody')}
            testID={`${ROUTE}.removeDialog`}
            actions={[
              { label: t('actions.cancel'), variant: 'secondary', onPress: () => setRemoving(null), testID: `${ROUTE}.removeDialog.cancel` },
              { label: leave ? t('team.leave') : t('team.remove'), destructive: true, onPress: confirmRemove, testID: `${ROUTE}.removeDialog.confirm` },
            ]}
          />
        </>
      }
    >
      {(collapseOn: (event: LayoutChangeEvent) => void) => (
        <View style={[column.style, styles.column]}>
          <View style={styles.head} onLayout={collapseOn}>
            <Text variant="title1" role="heading" aria-level={1} testID={`${ROUTE}.title`}>
              {business.name}
            </Text>
            <Text variant="callout" color="text.secondary">
              {business.subline}
            </Text>
            <View style={styles.actions}>
              <StatusPill label={t(`status.${business.status}`)} testID={`${ROUTE}.status`} />
            </View>
            {reason ? (
              <Text variant="callout" color="text.secondary" testID={`${ROUTE}.reason`}>
                {t('apply.reason', { reason })}
              </Text>
            ) : null}
            {restricted ? (
              <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
                {t('apply.restricted')}
              </Text>
            ) : null}
          </View>

          {verified ? (
            <View style={styles.stats} testID={`${ROUTE}.views`}>
              <Text variant="heroNumeralS" numeric>
                {format.number(views)}
              </Text>
              <Text variant="callout" color="text.secondary">
                {t('dashboard.views', { count: views })}
              </Text>
              <Text variant="caption" color="text.tertiary">
                {t('dashboard.viewsNote')}
              </Text>
            </View>
          ) : null}

          <RowCard testID={`${ROUTE}.links`}>
            {verified ? (
              <ListRow icon="eye" title={t('dashboard.viewProfile')} role="link" onPress={() => router.push({ pathname: '/b/[slug]', params: { slug: business.slug } })} divider testID={`${ROUTE}.viewProfile`} />
            ) : (
              <ListRow icon="eye" title={t('dashboard.viewApplication')} role="link" onPress={() => router.push('/settings/business/apply')} divider testID={`${ROUTE}.viewApplication`} />
            )}
            <ListRow
              icon="pencil-simple"
              title={t('dashboard.editProfile')}
              role="link"
              onPress={() => router.push({ pathname: '/settings/business/apply', params: { edit: '1' } })}
              divider={verified}
              testID={`${ROUTE}.edit`}
            />
            {verified ? (
              <ListRow
                icon="bell"
                title={t('dashboard.requests')}
                value={business.pending_requests > 0 ? t('dashboard.requestsOpen', { count: business.pending_requests, value: format.number(business.pending_requests) }) : undefined}
                role="link"
                onPress={() => router.push('/business/requests')}
                testID={`${ROUTE}.requests`}
              />
            ) : null}
          </RowCard>

          {verified ? (
            <View style={styles.section}>
              <BuildsWall
                title={t('business.portfolio')}
                count={business.portfolio_count ? t('counts.builds', { count: business.portfolio_count, value: format.number(business.portfolio_count) }) : null}
                vehicles={builds}
                width={phone ? width : column.inner}
                columns={WALL_COLUMNS_BY_KIND[kind]}
                loading={portfolio.isPending && portfolio.fetchStatus !== 'paused'}
                hasMore={portfolio.hasNextPage}
                loadingMore={portfolio.isFetchingNextPage}
                onMore={() => void portfolio.fetchNextPage()}
                bleed={phone ? column.gutter : 0}
                empty={
                  <Text variant="callout" color="text.secondary" testID={`${ROUTE}.portfolio.empty`}>
                    {t('dashboard.portfolioEmpty')}
                  </Text>
                }
                testID={`${ROUTE}.portfolio`}
              />
              <View style={styles.actions}>
                <Button label={t('dashboard.propose')} icon="plus" variant="secondary" size="m" disabled={restricted} onPress={() => setProposing(true)} testID={`${ROUTE}.propose`} />
              </View>
            </View>
          ) : null}

          <View style={styles.section} testID={`${ROUTE}.team`}>
            <GroupHeader title={t('team.title')} />
            <RowCard>
              {business.team.map((member, index) => {
                const name = member.username ?? t('team.gone');
                const self = member.username?.toLowerCase() === own;
                const removable = member.role === 'staff' && member.username !== null && (owner || self);
                return (
                  <ListRow
                    key={member.username ?? `gone.${index}`}
                    icon="user"
                    title={member.username ? `@${member.username}` : name}
                    subtitle={t(`team.roles.${member.role}`)}
                    hyphenate={false}
                    control={
                      removable ? (
                        <Button
                          label={self ? t('team.leave') : t('team.remove')}
                          variant="tertiary"
                          size="s"
                          accessibilityLabel={self ? t('team.leave') : t('team.removeLabel', { username: member.username ?? '' })}
                          onPress={() => setRemoving(member.username)}
                          testID={`${ROUTE}.team.${member.username ?? index}.remove`}
                        />
                      ) : undefined
                    }
                    divider={index < business.team.length - 1}
                    testID={`${ROUTE}.team.${member.username ?? index}`}
                  />
                );
              })}
            </RowCard>
            {owner ? (
              <View style={styles.actions}>
                <Button
                  label={t('team.add')}
                  icon="plus"
                  variant="secondary"
                  size="m"
                  disabled={business.team.length > BUSINESS_LIMITS.staffMax || restricted}
                  onPress={() => setAdding(true)}
                  testID={`${ROUTE}.team.add`}
                />
              </View>
            ) : null}
            <Text variant="caption" color="text.tertiary">
              {t('team.note')}
            </Text>
          </View>
        </View>
      )}
    </PartsPage>
  );
}

/** BIZ-03 Team "Mitglied hinzufügen": @username, one business per member (422), at most 10 staff (409 limit_reached). */
function AddMemberSheet({ visible, onClose, count }: { visible: boolean; onClose: () => void; count: number }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const add = useAddTeamMember();
  const key = useRef(newIdempotencyKey());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const match = USERNAME.exec(value.trim());
  const submit = () => {
    if (!match?.[1]) {
      setError(t('team.invalid'));
      return;
    }
    const username = match[1];
    add.mutate(
      { username, idempotencyKey: key.current },
      {
        onSuccess: () => {
          key.current = newIdempotencyKey();
          setValue('');
          setError(null);
          onClose();
          toast(t('team.added', { username }), { haptic: 'success', testID: `${ROUTE}.toast` });
        },
        onError: (failure) => {
          key.current = newIdempotencyKey();
          if (failure instanceof ApiError && failure.code === BUSINESS_CODES.limitReached) setError(t('team.limit', { max: BUSINESS_LIMITS.staffMax }));
          else setError(failure instanceof ApiError ? (Object.values(failure.fieldErrors)[0]?.[0] ?? failure.message) : t('team.failed'));
        },
      },
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('team.add')} testID={`${ROUTE}.addSheet`}>
      <View style={styles.sheet}>
        <Text variant="callout" color="text.secondary">
          {t('team.addIntro', { count, max: BUSINESS_LIMITS.staffMax })}
        </Text>
        <TextInput
          label={t('team.username')}
          value={value}
          onChangeText={(next) => {
            setValue(next);
            setError(null);
          }}
          onSubmitEditing={submit}
          placeholder={t('team.usernamePlaceholder')}
          error={error ?? undefined}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={41}
          testID={`${ROUTE}.addSheet.username`}
        />
        <Button label={t('team.addConfirm')} variant="primary" size="l" loading={add.isPending} disabled={!value.trim()} onPress={submit} testID={`${ROUTE}.addSheet.submit`} />
      </View>
    </Sheet>
  );
}
