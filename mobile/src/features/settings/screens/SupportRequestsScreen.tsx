import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { subjectOf, useSupportTickets, type SupportTicket, type SupportTicketStatus } from '@/api/queries/settings';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { GuestInvitation } from '@/features/profile/components/GuestInvitation';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Button, EmptyState, ErrorState, Hairline, Icon, RowGroup, Skeleton, SkeletonText, StatusPill, Text } from '@/ui';
import { endsWord, joinLabel, RowBody, RowDivider } from '@/ui/rowParts';
import { metaLineText } from '@/ui/textBreaks';

import { RestrictionNotice } from '../components/RestrictionNotice';
import { ROW_INSET } from '../components/ValueRow';
import { SettingsPage } from '../components/SettingsPage';

export const REQUESTS_ROUTE = 'SET-15a';
const SKELETON_ROWS = 4;

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[24] },
  row: { gap: t.space[8] },
  skeletonRow: { gap: t.space[4], justifyContent: 'center', minHeight: size.row.withThumb, paddingHorizontal: ROW_INSET, paddingVertical: t.space[12] },
  requestRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: size.row.withThumb,
    paddingHorizontal: ROW_INSET,
    paddingVertical: t.space[12],
  },
  requestText: { flex: 1, gap: t.space[4], minWidth: 0 },
  // As on SET-15b: the status pill first, the reference, topic and date after it, wrapping under it at a large font.
  requestMeta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  skeletonCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/** The words of a status: "Offen", "Antwort vom Team", "Erledigt". */
export function statusKey(status: SupportTicketStatus): `requests.status.${SupportTicketStatus}` {
  return `requests.status.${status}`;
}

/** "SC-20WB940H · QR-Sticker · 28.10.2026": wraps at its "·" first, never inside a part (DQ-671). */
export function requestMetaText(parts: readonly (string | null | undefined)[]): string {
  return metaLineText(parts.filter(Boolean).join(' · '));
}

type RequestRowProps = { title: string; status: string; meta: string; divider: boolean; onPress: () => void; testID: string };

/**
 * One request (DQ-671): the subject on the full width of the row, the status as the pill SET-15b shows, then the meta line. A
 * trailing status took a third of the row and squeezed the subject to three lines.
 */
function RequestRow({ title, status, meta, divider, onPress, testID }: RequestRowProps) {
  const styles = useStyles();
  return (
    <View testID={testID}>
      <RowBody onPress={onPress} label={joinLabel([title, status, meta])} style={styles.requestRow} testID={`${testID}.body`}>
        <View style={styles.requestText}>
          <Text variant="body">{endsWord(title, true)}</Text>
          <View style={styles.requestMeta}>
            <StatusPill label={endsWord(status, true)} testID={`${testID}.status`} />
            <Text variant="supporting" color="text.secondary" hyphenate={false} testID={`${testID}.meta`}>
              {meta}
            </Text>
          </View>
        </View>
        <Icon name="caret-right" size={16} color="text.tertiary" />
      </RowBody>
      {divider ? <RowDivider inset={ROW_INSET} lead={0} /> : null}
    </View>
  );
}

function RequestsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${REQUESTS_ROUTE}.skeleton`}>
      <View style={styles.skeletonCard}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index}>
            <View style={styles.skeletonRow}>
              <SkeletonText variant="body" width={index % 2 ? '55%' : '70%'} />
              <SkeletonText variant="supporting" width="40%" />
            </View>
            {index < SKELETON_ROWS - 1 ? <Hairline inset={ROW_INSET} /> : null}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/**
 * SET-15a /settings/help/requests (M3.5, support thread): the member's support requests, latest activity first, each with its
 * reference, topic and status; a row opens the thread (SET-15b). "Neue Anfrage" leads to SET-15.
 */
export function SupportRequestsScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const query = useSupportTickets();
  const tickets: readonly SupportTicket[] | undefined = qaState === 'empty' ? [] : query.data;
  const newRequest = (
    <Button
      label={t('requests.new')}
      variant="secondary"
      size="m"
      icon="plus"
      onPress={() => router.push('/settings/help/contact')}
      testID={`${REQUESTS_ROUTE}.new`}
    />
  );

  let body: ReactNode;
  if (status === 'guest') {
    body = <GuestInvitation routeId={REQUESTS_ROUTE} returnTo="/settings/help/requests" />;
  } else if (qaState === 'loading' || status === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) {
    body = <RequestsSkeleton />;
  } else if (qaState === 'error' || (!tickets && (query.isError || query.fetchStatus === 'paused'))) {
    const offline = !online || query.fetchStatus === 'paused' || (query.error instanceof ApiError && query.error.kind === 'network');
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('requests.errorTitle')}
        message={offline ? t('requests.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${REQUESTS_ROUTE}.error`}
      />
    );
  } else if (!tickets || tickets.length === 0) {
    body = (
      <EmptyState
        icon="lifebuoy"
        title={t('requests.emptyTitle')}
        body={t('requests.emptyBody')}
        action={{ label: t('requests.new'), onPress: () => router.push('/settings/help/contact'), variant: 'secondary', size: 'm' }}
        testID={`${REQUESTS_ROUTE}.empty`}
      />
    );
  } else {
    body = (
      <View style={styles.groups}>
        <RestrictionNotice routeId={REQUESTS_ROUTE} scope="support" />
        <RowGroup testID={`${REQUESTS_ROUTE}.list`}>
          {tickets.map((ticket, index) => {
            const created = ticket.created_at ? format.date(new Date(ticket.created_at)) : null;
            return (
              <RequestRow
                key={ticket.id}
                title={subjectOf(ticket) ?? t('requests.noSubject')}
                status={t(statusKey(ticket.status))}
                meta={requestMetaText([ticket.reference, t(`contact.categories.${ticket.category}`), created])}
                onPress={() => router.push({ pathname: '/settings/help/requests/[ticket]', params: { ticket: ticket.id } })}
                divider={index < tickets.length - 1}
                testID={`${REQUESTS_ROUTE}.row.${ticket.id}`}
              />
            );
          })}
        </RowGroup>
        <View style={styles.row}>{newRequest}</View>
      </View>
    );
  }

  return (
    <SettingsPage routeId={REQUESTS_ROUTE} title={t('requests.title')} fallback="/settings/help" offlineLabel={t('requests.offlineBanner')} section="contact">
      {body}
    </SettingsPage>
  );
}

