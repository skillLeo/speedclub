import '@/features/events/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  EVENT_LIMITS,
  isInReview,
  isUnavailable,
  useCancelEvent,
  useDeleteEvent,
  useEvent,
  useEventUpdates,
  usePostEventUpdate,
} from '@/api/queries/events';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Hairline,
  ListRow,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  TextInput,
  toast,
} from '@/ui';

import { useOrganiserRestriction } from '../access';
import { EventCardView } from '../components/EventCardView';
import { EventPage } from '../components/EventPage';
import { EventSection, RestrictionLine, ReviewBanner } from '../components/EventParts';
import { editorPath, hasEnded, reviewNotice } from '../model';

const ROUTE = 'EVT-06';
const UPDATE_ROWS = 5;

const useStyles = createStyles((t) => ({
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  composer: { gap: t.space[12] },
  send: { alignSelf: 'flex-start' },
  updates: { gap: t.space[12] },
  update: { gap: t.space[4] },
  danger: { alignItems: 'flex-start', gap: t.space[8] },
  skeleton: { gap: t.space[24] },
}));

/**
 * EVT-06 Organisator-Tools `/events/[slug]/manage` (09 §7.10): edit, the attendee list, an update to everybody with an answer
 * (Idempotency-Key; never the text in a push, ADR-437), cancel with a reason that notifies attendees, delete where allowed. While
 * the event is in review everything is frozen (ADR-439).
 */
export function ManageEventScreen() {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = paramOf(params.slug) ?? '';
  const back = useBack(`/events/${slug}`);
  const qaState = useQaState();
  const online = useOnline();
  const format = useFormat();
  const own = useSessionStore((state) => state.member?.username);
  const restriction = useOrganiserRestriction();
  const query = useEvent(slug);
  const event = qaState === 'default' || qaState === 'restricted' ? query.data : undefined;
  const organiser = Boolean(own && event && own.toLowerCase() === event.organiser.username.toLowerCase());
  const updates = useEventUpdates(slug, organiser);
  const post = usePostEventUpdate(slug);
  const cancel = useCancelEvent();
  const remove = useDeleteEvent();
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const updateKey = useRef(newIdempotencyKey());

  let body: ReactNode;
  let centred = true;
  if (
    qaState === 'loading' ||
    (qaState === 'default' && !query.data && query.isPending && query.fetchStatus !== 'paused')
  ) {
    centred = false;
    body = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.skeleton}>
          <SkeletonBlock height={size.avatar.xl} corner="md" />
          <SkeletonText variant="calloutStrong" width="30%" />
          <SkeletonBlock height={size.avatar.xl * 2} corner="md" />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'empty' || isUnavailable(query.error) || (event && !organiser)) {
    body = (
      <EmptyState
        icon="lock-simple"
        title={t('manage.notOrganiserTitle')}
        body={t('manage.notOrganiserBody')}
        action={{ label: t('detail.toEvents'), onPress: back, variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notOrganiser`}
      />
    );
  } else if (!event) {
    const offline =
      qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    body = (
      <ErrorState
        title={offline ? t('list.offlineTitle') : t('detail.errorTitle')}
        message={offline ? t('list.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else {
    centred = false;
    const pending = event.status === 'pending_review';
    const closed = event.status === 'cancelled' || hasEnded(event, now());
    const notice = reviewNotice(event);
    const locked = restriction !== null;
    const deletable = event.status !== 'published' || closed;

    const send = () => {
      const value = text.trim();
      if (value.length < EVENT_LIMITS.updateMin) {
        setTextError(t('validation.required'));
        haptics.warning();
        return;
      }
      setTextError(null);
      post.mutate(
        { body: value, idempotencyKey: updateKey.current },
        {
          onSuccess: () => {
            haptics.success();
            setText('');
            updateKey.current = newIdempotencyKey();
            toast(t('manage.updateSent'), { testID: `${ROUTE}.toast` });
          },
          onError: (error) => {
            haptics.error();
            if (error instanceof ApiError && error.fieldErrors.body?.[0])
              setTextError(error.fieldErrors.body[0]);
            else
              toast(error instanceof ApiError && error.message ? error.message : t('manage.updateFailed'), {
                testID: `${ROUTE}.toast`,
              });
          },
        },
      );
    };

    const confirmCancel = () => {
      const value = reason.trim();
      if (value === '') {
        setReasonError(t('manage.reasonRequired'));
        return;
      }
      cancel.mutate(
        { slug: event.slug, reason: value },
        {
          onSuccess: () => {
            haptics.success();
            setCancelling(false);
            toast(t('manage.cancelled'), { testID: `${ROUTE}.toast` });
          },
          onError: (error) => {
            haptics.error();
            setReasonError(
              error instanceof ApiError && error.fieldErrors.reason?.[0]
                ? error.fieldErrors.reason[0]
                : isInReview(error)
                  ? t('editor.inReview')
                  : t('manage.cancelFailed'),
            );
          },
        },
      );
    };

    const confirmDelete = () => {
      remove.mutate(event.slug, {
        onSuccess: () => {
          haptics.success();
          setDeleting(false);
          toast(t('manage.deleted'), { testID: `${ROUTE}.toast` });
          router.replace('/profile/events?tab=organised');
        },
        onError: (error) => {
          haptics.error();
          setDeleting(false);
          toast(
            error instanceof ApiError && error.kind === 'conflict'
              ? t('manage.deleteNeedsCancel')
              : t('manage.deleteFailed'),
            { testID: `${ROUTE}.toast` },
          );
        },
      });
    };

    body = (
      <>
        <EventCardView event={event} routeId={ROUTE} showStatus trailing={<View />} />
        {restriction ? <RestrictionLine message={restriction} testID={`${ROUTE}.restricted`} /> : null}
        {notice ? (
          <ReviewBanner
            notice={notice}
            byStaff={event.cancelled_by_staff}
            organiser
            onAction={() => router.push(editorPath(event.slug))}
            testID={`${ROUTE}.review`}
          />
        ) : null}
        {closed && !pending ? (
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.closed`}>
            {t('manage.closedNotice')}
          </Text>
        ) : null}
        <View style={styles.group}>
          <ListRow
            icon="pencil-simple"
            title={t('manage.edit')}
            role="link"
            disabled={pending || closed || locked || !event.can.edit}
            onPress={() => router.push(editorPath(event.slug))}
            divider
            testID={`${ROUTE}.edit`}
          />
          <ListRow
            icon="users"
            title={t('manage.attendees')}
            value={event.counts && event.status === 'published' ? format.number(event.counts.going) : undefined}
            role="link"
            disabled={!event.can.view_attendees}
            onPress={() =>
              router.push({ pathname: '/events/[slug]/attendees', params: { slug: event.slug } })
            }
            testID={`${ROUTE}.attendees`}
          />
        </View>
        {event.can.post_update ? (
          <EventSection title={t('manage.updateTitle')} testID={`${ROUTE}.composer`}>
            <View style={styles.composer}>
              <TextInput
                label={t('manage.updateLabel')}
                placeholder={t('manage.updatePlaceholder')}
                helper={t('manage.updateHelper')}
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  if (textError) setTextError(null);
                }}
                error={textError ?? undefined}
                multiline
                maxRows={UPDATE_ROWS}
                maxLength={EVENT_LIMITS.updateMax}
                disabled={locked || !online}
                testID={`${ROUTE}.updateText`}
              />
              <Button
                label={t('manage.updateSend')}
                size="m"
                loading={post.isPending}
                disabled={locked || !online}
                onPress={send}
                style={styles.send}
                testID={`${ROUTE}.updateSend`}
              />
            </View>
          </EventSection>
        ) : null}
        <EventSection title={t('manage.updates')} testID={`${ROUTE}.updates`}>
          {updates.data && updates.data.length > 0 ? (
            <View style={styles.updates}>
              {updates.data.map((update, index) => (
                <View key={update.id} style={styles.update} testID={`${ROUTE}.update.${update.id}`}>
                  {index > 0 ? <Hairline /> : null}
                  <Text variant="caption" color="text.secondary" numeric>
                    {update.created_at ? format.dateTime(new Date(update.created_at)) : ''}
                  </Text>
                  <Text variant="body">{update.body}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text variant="callout" color="text.secondary">
              {updates.isError ? t('detail.updatesError') : t('detail.updatesEmpty')}
            </Text>
          )}
        </EventSection>
        <View style={styles.danger}>
          {event.can.cancel ? (
            <Button
              label={t('manage.cancelTitle')}
              variant="destructive"
              size="m"
              flush="start"
              disabled={locked || !online}
              onPress={() => setCancelling(true)}
              testID={`${ROUTE}.cancel`}
            />
          ) : null}
          {deletable ? (
            <Button
              label={t('manage.delete')}
              variant="destructive"
              size="m"
              flush="start"
              disabled={locked || !online || pending}
              onPress={() => setDeleting(true)}
              testID={`${ROUTE}.delete`}
            />
          ) : null}
        </View>
        <Dialog
          visible={cancelling}
          onClose={() => setCancelling(false)}
          title={t('manage.cancelTitle')}
          body={t('manage.cancelBody')}
          actions={[
            {
              label: t('editor.close'),
              variant: 'secondary',
              onPress: () => setCancelling(false),
              testID: `${ROUTE}.cancelDialog.back`,
            },
            {
              label: t('manage.cancelConfirm'),
              destructive: true,
              loading: cancel.isPending,
              onPress: confirmCancel,
              testID: `${ROUTE}.cancelDialog.confirm`,
            },
          ]}
          testID={`${ROUTE}.cancelDialog`}
        >
          <TextInput
            label={t('manage.cancelReasonLabel')}
            placeholder={t('manage.cancelReasonPlaceholder')}
            value={reason}
            onChangeText={(value) => {
              setReason(value);
              if (reasonError) setReasonError(null);
            }}
            error={reasonError ?? undefined}
            multiline
            maxRows={3}
            maxLength={EVENT_LIMITS.reasonMax}
            testID={`${ROUTE}.cancelReason`}
          />
        </Dialog>
        <Dialog
          visible={deleting}
          onClose={() => setDeleting(false)}
          title={t('manage.deleteTitle')}
          body={t('manage.deleteBody')}
          actions={[
            {
              label: t('editor.close'),
              variant: 'secondary',
              onPress: () => setDeleting(false),
              testID: `${ROUTE}.deleteDialog.back`,
            },
            {
              label: t('manage.deleteConfirm'),
              destructive: true,
              loading: remove.isPending,
              onPress: confirmDelete,
              testID: `${ROUTE}.deleteDialog.confirm`,
            },
          ]}
          testID={`${ROUTE}.deleteDialog`}
        />
      </>
    );
  }

  return (
    <EventPage
      routeId={ROUTE}
      title={t('manage.title')}
      onBack={back}
      offlineLabel={t('detail.offlineBanner')}
      centred={centred}
    >
      {body}
    </EventPage>
  );
}
