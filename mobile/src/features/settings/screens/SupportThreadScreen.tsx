import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { subjectOf, useReplyToSupportTicket, useSupportThread, type SupportThread } from '@/api/queries/settings';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors, formatWait } from '@/features/auth/forms';
import { GuestInvitation } from '@/features/profile/components/GuestInvitation';
import { paramOf } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { EmptyState, ErrorState, Icon, Skeleton, SkeletonText, StatusPill, Text, TextInput, toast } from '@/ui';

import { SettingsPage } from '../components/SettingsPage';
import { useFailureMessage, useFieldMessage } from '../forms';
import { MESSAGE_MAX_LENGTH, supportReplySchema, type SupportReplyValues } from '../schemas';

import { requestMetaText, statusKey } from './SupportRequestsScreen';

export const THREAD_ROUTE = 'SET-15b';
const REPLY_ROWS = 6;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  head: { gap: t.space[8] },
  meta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  messages: { gap: t.space[16] },
  // §8 cards on the canvas: the team's reply on bg.surface, the member's own on bg.raised, both left-aligned to read as a record.
  message: { borderRadius: t.radius.md, gap: t.space[8], padding: t.space[16] },
  member: { backgroundColor: t.color.bg.raised },
  team: { backgroundColor: t.color.bg.surface, borderColor: t.color.border.default, borderWidth: t.size.border.control },
  author: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  reply: { gap: t.space[12] },
}));

function ThreadSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${THREAD_ROUTE}.skeleton`}>
      <View style={styles.body}>
        <View style={styles.head}>
          <SkeletonText variant="titleM" width="70%" />
          <SkeletonText variant="supporting" width="50%" />
        </View>
        <View style={styles.messages}>
          {[3, 2].map((lines, index) => (
            <View key={index} style={[styles.message, styles.member]}>
              <SkeletonText variant="labelS" width="35%" />
              {Array.from({ length: lines }, (_, line) => (
                <SkeletonText key={line} variant="body" width={line === lines - 1 ? '60%' : '100%'} />
              ))}
            </View>
          ))}
        </View>
      </View>
    </Skeleton>
  );
}

function Messages({ thread }: { thread: SupportThread }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const format = useFormat();
  const created = thread.created_at ? format.date(new Date(thread.created_at)) : null;
  return (
    <>
      <View style={styles.head}>
        <Text variant="titleM" role="heading" {...({ 'aria-level': 1 } as object)} testID={`${THREAD_ROUTE}.subject`}>
          {subjectOf(thread) ?? t('requests.noSubject')}
        </Text>
        <View style={styles.meta}>
          <StatusPill label={t(statusKey(thread.status))} testID={`${THREAD_ROUTE}.status`} />
          <Text variant="supporting" color="text.secondary" selectable testID={`${THREAD_ROUTE}.meta`}>
            {requestMetaText([thread.reference, t(`contact.categories.${thread.category}`), created])}
          </Text>
        </View>
      </View>
      <View style={styles.messages} role="list" testID={`${THREAD_ROUTE}.messages`}>
        {thread.messages.map((message) => {
          const team = message.author === 'team';
          return (
            <View key={message.id} role="listitem" style={[styles.message, team ? styles.team : styles.member]} testID={`${THREAD_ROUTE}.message.${message.id}`}>
              <View style={styles.author}>
                <Icon name={team ? 'lifebuoy' : 'user'} size={16} color="text.secondary" />
                <Text variant="labelS" color="text.secondary">
                  {team ? t('requests.team') : t('requests.you')}
                </Text>
                <Text variant="caption" color="text.tertiary">
                  {format.dateTime(new Date(message.created_at))}
                </Text>
              </View>
              <Text variant="body" selectable>
                {message.body}
              </Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

/** The sentence of a failed reply: the shared 5-an-hour limit with its wait, else the server's words or the plain fallback. */
export function replyFailure(error: unknown, t: TFunction<'settings'>, authT: TFunction<'auth'>, failure: (error: unknown) => string): string {
  if (error instanceof ApiError && error.kind === 'rate_limited') {
    return error.retryAfter ? t('requests.reply.rateLimited', { wait: formatWait(authT, error.retryAfter) }) : t('requests.reply.rateLimitedLater');
  }
  return failure(error);
}

/**
 * The thread with the reply composer (ADR-249): the member writes again in their own request, and the answer is the whole thread,
 * now "offen" again (a closed request too). One idempotency key per text: a retry after a lost answer is the same intent and never
 * posts twice; a changed text is a new one.
 */
function ThreadPage({ thread, id }: { thread: SupportThread; id: string }) {
  const { t } = useTranslation('settings');
  const { t: authT } = useTranslation('auth');
  const styles = useStyles();
  const fieldMessage = useFieldMessage();
  const failure = useFailureMessage();
  const reply = useReplyToSupportTicket(id);
  const attempt = useRef<{ key: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { control, handleSubmit, setError, reset, formState } = useForm<SupportReplyValues>({
    resolver: zodResolver(supportReplySchema),
    mode: 'onTouched',
    defaultValues: { message: '' },
  });
  const message = useWatch({ control, name: 'message' });
  const closed = thread.status === 'closed';

  const send = async (values: SupportReplyValues) => {
    const text = values.message.trim();
    if (attempt.current?.text !== text) attempt.current = { key: newIdempotencyKey(), text };
    setNotice(null);
    try {
      await reply.mutateAsync({ message: text, idempotencyKey: attempt.current.key });
      attempt.current = null;
      reset({ message: '' });
      toast(t('requests.reply.sent'), { haptic: 'success', testID: `${THREAD_ROUTE}.sent` });
    } catch (error) {
      // A refused text (422) or a closed account (403) is answered: the next try is a new intent.
      if (error instanceof ApiError && (error.kind === 'validation' || error.kind === 'forbidden')) attempt.current = null;
      setNotice(
        error instanceof ApiError && error.kind === 'validation'
          ? applyServerErrors(error, setError, { message: 'message' })
          : replyFailure(error, t, authT, failure),
      );
    }
  };
  // Built on the press, not during render: the key lives in a ref.
  const onSubmit = () => handleSubmit(send)();

  return (
    <SettingsPage
      routeId={THREAD_ROUTE}
      title={t('requests.threadTitle')}
      fallback="/settings/help/requests"
      offlineLabel={t('requests.offlineBanner')}
      section="contact"
      form={{
        dirty: formState.isDirty && !reply.isPending,
        cta: { label: t('requests.reply.submit'), onPress: () => void onSubmit(), loading: reply.isPending },
      }}
    >
      <View style={styles.body}>
        <Messages thread={thread} />
        <View style={styles.reply} testID={`${THREAD_ROUTE}.reply`}>
          <Text variant="titleS" role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('requests.reply.title')}
          </Text>
          <Text variant="supporting" color="text.secondary" testID={`${THREAD_ROUTE}.replyHint`}>
            {closed ? t('requests.reply.closedHint') : t('requests.reply.hint')}
          </Text>
          {notice ? <FormNotice message={notice} testID={`${THREAD_ROUTE}.notice`} /> : null}
          <Controller
            control={control}
            name="message"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('requests.reply.label')}
                helper={t('contact.messageCount', { count: message.length, max: MESSAGE_MAX_LENGTH })}
                error={fieldMessage(fieldState.error)}
                multiline
                maxRows={REPLY_ROWS}
                maxLength={MESSAGE_MAX_LENGTH}
                testID={`${THREAD_ROUTE}.reply.input`}
              />
            )}
          />
        </View>
      </View>
    </SettingsPage>
  );
}

/**
 * SET-15b /settings/help/requests/[ticket] (M3.5, support thread; replies ADR-249): the member's messages and the team's replies, oldest
 * first, and the composer under them; the team appears as "Team", internal notes never come.
 */
export function SupportThreadScreen() {
  const { t } = useTranslation('settings');
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const params = useLocalSearchParams<{ ticket?: string | string[] }>();
  const id = paramOf(params.ticket) ?? '';
  const returnTo = `/settings/help/requests/${id}`;
  const query = useSupportThread(qaState === 'default' || qaState === 'offline' || qaState === 'restricted' ? id : '');

  let body: ReactNode;
  if (status === 'guest') {
    body = <GuestInvitation routeId={THREAD_ROUTE} returnTo={returnTo} />;
  } else if (qaState === 'empty' || (query.error instanceof ApiError && query.error.kind === 'not_found')) {
    body = <EmptyState icon="lifebuoy" title={t('requests.goneTitle')} body={t('requests.goneBody')} testID={`${THREAD_ROUTE}.gone`} />;
  } else if (qaState === 'loading' || status === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    body = <ThreadSkeleton />;
  } else if (qaState === 'error' || !query.data) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('requests.threadErrorTitle')}
        message={offline ? t('requests.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${THREAD_ROUTE}.error`}
      />
    );
  } else {
    return <ThreadPage thread={query.data} id={id} />;
  }

  return (
    <SettingsPage routeId={THREAD_ROUTE} title={t('requests.threadTitle')} fallback="/settings/help/requests" offlineLabel={t('requests.offlineBanner')} section="contact">
      {body}
    </SettingsPage>
  );
}
