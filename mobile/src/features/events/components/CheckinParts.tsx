import '@/features/events/i18n';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { newIdempotencyKey } from '@/api/client';
import {
  canShowCheckinCode,
  CHECKIN_CODE_LENGTH,
  checkinOf,
  checkinRefusal,
  groupCheckinCode,
  normaliseCheckinCode,
  useCheckIn,
  useCheckinCode,
  useCheckinEnabled,
  useCheckinVisibility,
  useRemoveCheckin,
  type CheckinAnswer,
} from '@/api/queries/eventCheckin';
import type { EventDetail } from '@/api/queries/events';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Icon } from '@/ui/icons/Icon';
import { ListRow } from '@/ui/ListRow';
import { QRDisplay } from '@/ui/QRDisplay';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Switch } from '@/ui/Switch';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

import { checkinOffer, checkinSchema, type CheckinFormValues } from '../checkin';
import { clockText, momentText, parseInstant } from '../model';

/** Six characters plus the space or dashes a member may type between them. */
const CODE_INPUT_MAX = CHECKIN_CODE_LENGTH + 3;

const useStyles = createStyles((t) => ({
  form: { gap: t.space[16] },
  switchRow: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  block: { gap: t.space[8] },
  done: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  doneText: { flex: 1, gap: t.space[2], minWidth: 0 },
  action: { alignSelf: 'flex-start' },
  sheet: { gap: t.space[16], paddingBottom: t.space[16] },
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  codeBlock: { gap: t.space[8] },
  // On the rows' text inset (16 inside the card), as a grouped list's header above it.
  footnote: { paddingHorizontal: t.space[16] },
  codeSkeleton: { alignItems: 'center', alignSelf: 'center', gap: t.space[12], maxWidth: t.size.qrMaxOnScreen, width: '100%' },
}));

type CheckinFormOptions = {
  slug: string;
  /** The code a link carried (EVT-07). */
  defaultCode?: string | null;
  routeId: string;
  onDone: (answer: CheckinAnswer) => void;
};

/**
 * The check-in form of EVT-02's sheet and EVT-07 (React Hook Form + Zod): the code (spaces and capitals forgiven) and "Auf meinem
 * Profil zeigen". A wrong or expired code goes to the field (422 `checkin_code_invalid`), a closed window, the organiser's own event
 * and too many tries to the notice above. One Idempotency-Key per intent, kept across retries.
 */
export function useCheckinForm({ slug, defaultCode, routeId, onDone }: CheckinFormOptions) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const online = useOnline();
  const checkIn = useCheckIn(slug);
  const [notice, setNotice] = useState<string | null>(null);
  // One key per intent, kept across retries of it (a wrong code is a new intent).
  const [key, setKey] = useState(newIdempotencyKey);
  const form = useForm<CheckinFormValues>({
    resolver: zodResolver(checkinSchema(t)),
    mode: 'onSubmit',
    defaultValues: { code: defaultCode ? groupCheckinCode(normaliseCheckinCode(defaultCode) ?? defaultCode) : '', profileVisible: true },
  });

  const submit = form.handleSubmit(
    (values) => {
      const code = normaliseCheckinCode(values.code);
      if (!code) return;
      setNotice(null);
      checkIn.mutate(
        { code, profileVisible: values.profileVisible, idempotencyKey: key },
        {
          onSuccess: (answer) => {
            haptics.success();
            setKey(newIdempotencyKey());
            onDone(answer);
          },
          onError: (error) => {
            haptics.error();
            const reason = checkinRefusal(error);
            if (reason === 'code') {
              setKey(newIdempotencyKey());
              form.setError('code', { message: t('checkin.codeInvalid') });
            } else {
              setNotice(
                t(
                  reason === 'closed'
                    ? 'checkin.closed'
                    : reason === 'own'
                      ? 'checkin.own'
                      : reason === 'rateLimited'
                        ? 'checkin.rateLimited'
                        : 'checkin.failed',
                ),
              );
            }
          },
        },
      );
    },
    () => haptics.warning(),
  );

  const fields: ReactNode = (
    <View style={styles.form}>
      {notice ? <FormNotice message={notice} testID={`${routeId}.checkin.notice`} /> : null}
      {online ? null : <FormNotice tone="info" message={t('checkin.screen.offline')} testID={`${routeId}.checkin.offline`} />}
      <Controller
        control={form.control}
        name="code"
        render={({ field, fieldState }) => (
          <TextInput
            label={t('checkin.codeLabel')}
            placeholder={t('checkin.codePlaceholder')}
            helper={t('checkin.codeHelper')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={CODE_INPUT_MAX}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            testID={`${routeId}.checkin.code`}
          />
        )}
      />
      <Controller
        control={form.control}
        name="profileVisible"
        render={({ field }) => (
          <View style={styles.switchRow}>
            <ListRow
              title={t('checkin.profileVisible')}
              subtitle={t('checkin.profileVisibleHelper')}
              control={
                <Switch
                  value={field.value}
                  onValueChange={field.onChange}
                  label={t('checkin.profileVisible')}
                  testID={`${routeId}.checkin.profileVisible.switch`}
                />
              }
              testID={`${routeId}.checkin.profileVisible`}
            />
          </View>
        )}
      />
    </View>
  );

  return { fields, submit: () => void submit(), busy: checkIn.isPending, disabled: !online };
}

/** EVT-02 "Einchecken": the form in a sheet, its button sticky above the keyboard. */
function CheckinSheet({
  visible,
  onClose,
  event,
  routeId,
}: {
  visible: boolean;
  onClose: () => void;
  event: EventDetail;
  routeId: string;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const form = useCheckinForm({
    slug: event.slug,
    routeId,
    onDone: () => {
      onClose();
      toast(t('checkin.done'), { testID: `${routeId}.checkin.toast` });
    },
  });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('checkin.sheetTitle')}
      narrow={kind !== 'phone'}
      footer={
        <Button
          label={t('checkin.submit')}
          fullWidth
          loading={form.busy}
          disabled={form.disabled}
          onPress={form.submit}
          testID={`${routeId}.checkin.submit`}
        />
      }
      testID={`${routeId}.checkin.sheet`}
    >
      <View style={styles.sheet}>
        <Text variant="body" color="text.secondary">
          {t('checkin.sheetBody')}
        </Text>
        {form.fields}
      </View>
    </Sheet>
  );
}

/**
 * M5.6 EVT-02 check-in (10 §4; m5.6-contract §5), behind `events.checkin`: "Einchecken" while the window is open, "War dabei" with
 * "Auf meinem Profil zeigen" and "Check-in entfernen" once checked in, the opening time for a member who is going. Nothing for the
 * organiser (EVT-06 shows the code) and nothing while the flag is off.
 */
export function CheckinBlock({ event, organiser, routeId }: { event: EventDetail; organiser: boolean; routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const enabled = useCheckinEnabled();
  const member = useSessionStore((state) => state.status === 'member');
  const visibility = useCheckinVisibility(event.slug);
  const remove = useRemoveCheckin(event.slug);
  const [open, setOpen] = useState(false);
  const offer = checkinOffer(event, { enabled: enabled && member, organiser, now: now() });

  if (offer.kind === 'none') return null;

  if (offer.kind === 'later') {
    return (
      <Text variant="callout" color="text.secondary" numeric testID={`${routeId}.checkin.later`}>
        {t('checkin.opensAt', { time: momentText(offer.opensAt, format.locale, t) })}
      </Text>
    );
  }

  if (offer.kind === 'open') {
    return (
      <View style={styles.block} testID={`${routeId}.checkin`}>
        <Button
          label={t('checkin.button')}
          icon="qr-code"
          variant="secondary"
          size="m"
          accessibilityLabel={t('checkin.buttonLabel', { title: event.title })}
          disabled={!online}
          onPress={() => setOpen(true)}
          style={styles.action}
          testID={`${routeId}.checkin.open`}
        />
        <CheckinSheet visible={open} onClose={() => setOpen(false)} event={event} routeId={routeId} />
      </View>
    );
  }

  const mine = offer.info.mine;
  if (!mine) return null;
  const at = parseInstant(mine.checked_in_at);
  return (
    <View style={styles.block} testID={`${routeId}.checkin.done`}>
      <View style={styles.done}>
        <Icon name="check-circle" size={24} color="text.primary" />
        <View style={styles.doneText}>
          <Text variant="headline" testID={`${routeId}.checkin.wasThere`}>
            {t('checkin.wasThere')}
          </Text>
          {at ? (
            <Text variant="caption" color="text.secondary" numeric>
              {t('checkin.checkedInAt', { time: clockText(at, format.locale, t) })}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.group}>
        <ListRow
          title={t('checkin.profileVisible')}
          subtitle={mine.profile_visible ? t('checkin.onProfileLater') : t('checkin.onlyYou')}
          control={
            <Switch
              value={mine.profile_visible}
              onValueChange={(next) =>
                visibility.mutate(next, {
                  onError: () => toast(t('checkin.visibilityFailed'), { haptic: 'warning', testID: `${routeId}.checkin.toast` }),
                })
              }
              label={t('checkin.profileVisible')}
              disabled={!online}
              testID={`${routeId}.checkin.visible.switch`}
            />
          }
          testID={`${routeId}.checkin.visible`}
        />
      </View>
      <Button
        label={t('checkin.remove')}
        variant="destructive"
        size="s"
        flush="start"
        loading={remove.isPending}
        disabled={!online}
        onPress={() =>
          remove.mutate(undefined, {
            onSuccess: () => toast(t('checkin.removed'), { testID: `${routeId}.checkin.toast` }),
            onError: () => toast(t('checkin.removeFailed'), { haptic: 'warning', testID: `${routeId}.checkin.toast` }),
          })
        }
        testID={`${routeId}.checkin.remove`}
      />
    </View>
  );
}

/** EVT-06: the organiser's code on a white card, asked again before it rotates while the sheet is open. */
function CheckinCodeSheet({ visible, onClose, event, routeId }: { visible: boolean; onClose: () => void; event: EventDetail; routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const { kind } = useBreakpoint();
  const query = useCheckinCode(event.slug, visible);
  const code = query.data;
  const shownCode = code?.code;
  // 09 §4.8 medium: the QR reveal, once per code that appears.
  useEffect(() => {
    if (visible && shownCode) haptics.medium();
  }, [shownCode, visible]);

  let body: ReactNode;
  if (code) {
    body = (
      <>
        <QRDisplay
          svg={code.svg}
          code={groupCheckinCode(code.code)}
          label={t('checkin.organiser.qrLabel', { title: event.title })}
          testID={`${routeId}.checkinCode.qr`}
        />
        <Text variant="headline" numeric testID={`${routeId}.checkinCode.count`}>
          {t('checkin.organiser.count', { count: code.checked_in, value: format.number(code.checked_in) })}
        </Text>
        <Text variant="callout" color="text.secondary">
          {t('checkin.organiser.hint')}
        </Text>
      </>
    );
  } else if (query.isPending && query.fetchStatus !== 'paused') {
    body = (
      <Skeleton testID={`${routeId}.checkinCode.skeleton`}>
        <View style={styles.codeSkeleton}>
          <SkeletonBlock aspectRatio={1} width="100%" corner="md" />
          <SkeletonText variant="headline" width="40%" />
        </View>
      </Skeleton>
    );
  } else {
    body = (
      <ErrorState
        title={t('checkin.organiser.error')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${routeId}.checkinCode.error`}
      />
    );
  }
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('checkin.organiser.sheetTitle')}
      narrow={kind !== 'phone'}
      testID={`${routeId}.checkinCode`}
    >
      <View style={styles.sheet}>{body}</View>
    </Sheet>
  );
}

/**
 * M5.6 EVT-06 "Check-in-Code zeigen" (m5.6-contract §5.3), behind `events.checkin`: the row with the real number of check-ins, the
 * code sheet while the window is open, the opening time before it, "vorbei" after it.
 */
export function CheckinCodeRow({ event, routeId }: { event: EventDetail; routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const enabled = useCheckinEnabled();
  const [open, setOpen] = useState(false);
  const info = enabled ? checkinOf(event) : null;
  if (!info) return null;
  const showable = canShowCheckinCode(event);
  const opens = parseInstant(info.opens_at);
  const closes = parseInstant(info.closes_at);
  const ended = closes !== null && closes.getTime() <= now().getTime();
  const helper = showable
    ? t('checkin.organiser.rowHelper')
    : ended
      ? t('checkin.organiser.rowEnded')
      : opens
        ? t('checkin.organiser.rowClosed', { time: momentText(opens, format.locale, t) })
        : undefined;
  // DQ-P5-013: the row is the action and its number ("Check-in-Code zeigen … 12 eingecheckt"); the long helper of an open window runs
  // the full width under the card as the group's footnote, never squeezed into a narrow column beside the value. The short state lines
  // ("Ab 18:00 Uhr.", "Der Check-in ist vorbei.") stay the row's subtitle.
  return (
    <>
      <View style={styles.codeBlock}>
        <View style={styles.group}>
          <ListRow
            icon="qr-code"
            title={t('checkin.organiser.row')}
            subtitle={showable ? undefined : helper}
            value={info.count !== null ? t('checkin.organiser.count', { count: info.count, value: format.number(info.count) }) : undefined}
            role="button"
            disabled={!showable}
            onPress={() => setOpen(true)}
            testID={`${routeId}.checkinCode.row`}
          />
        </View>
        {showable && helper ? (
          <Text variant="callout" color="text.secondary" style={styles.footnote} testID={`${routeId}.checkinCode.helper`}>
            {helper}
          </Text>
        ) : null}
      </View>
      <CheckinCodeSheet visible={open} onClose={() => setOpen(false)} event={event} routeId={routeId} />
    </>
  );
}

