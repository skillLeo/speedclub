import { zodResolver } from '@hookform/resolvers/zod';
import { usePathname, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';
import { z } from 'zod';

import { newIdempotencyKey } from '@/api/client';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { formatNumber } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useOnline } from '@/state/online';
import { isInternalPath, useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Dialog, Hairline, Icon, ListRow, Sheet, Text, TextInput } from '@/ui';

import { useSafety } from './data';
import { ILLEGAL_SUB_REASONS, REPORT_REASONS, type ReportTarget } from './model';
import {
  blockOffer,
  buildReportInput,
  DETAILS_MAX_LENGTH,
  DETAILS_MIN_ILLEGAL,
  INITIAL_FLOW,
  isRetryable,
  MESSAGE_CONTEXT_SIZE,
  reportFailure,
  reportFlow,
  type ReportFailure,
  type ReportFlowEvent,
  type ReportStep,
} from './reportFlow';

/** The page of the web form for a report without an account (WEB-09), served by Laravel next to the member web. */
export const WEB_REPORT_FORM_PATH = '/melden';
export const REPORTS_PATH = '/settings/reports';

/** Illegal content needs its explanation (Art. 16(2)(a) DSA, at least 10 characters); everything else may stay empty. */
function detailsSchema(illegal: boolean) {
  return z.object({
    details: z
      .string()
      .max(DETAILS_MAX_LENGTH, 'report.tooLong')
      .refine((value) => !illegal || value.trim().length >= DETAILS_MIN_ILLEGAL, 'report.detailsRequired'),
  });
}
type DetailsValues = z.infer<ReturnType<typeof detailsSchema>>;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  rows: { marginBottom: t.space[8] },
  chosen: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  chosenText: { flex: 1, gap: t.space[2] },
  footer: { gap: t.space[8] },
  done: { alignItems: 'flex-start', gap: t.space[12] },
  offer: { gap: t.space[8] },
  rule: { marginTop: t.space[8] },
}));

export type ReportSheetProps = {
  visible: boolean;
  target: ReportTarget;
  onClose: () => void;
  /** "Auch blockieren?" was tapped: the sheet has closed, and the caller opens the BlockDialog for this member. */
  onBlock?: (username: string) => void;
  /** The member is blocked already in this flow ("Blockieren & melden"), so the sent step offers no block. */
  blocked?: boolean;
  /** `<ROUTE-ID>.report`; the steps add `.reason.<key>`, `.subReason.<key>`, `.details`, `.send`, `.sent` and so on. */
  testID: string;
};

/**
 * The report flow of SAFE (Art. 16 DSA, contract §5): reason → sub-reason (only for illegal content) → optional details → sent. One
 * idempotency key per report intent, kept across retries and renewed when the reason changes, so a retry after a lost answer never
 * files the report twice. A duplicate ends in its own calm step, never in an error.
 */
export function ReportSheet({ visible, target, onClose, onBlock, blocked = false, testID }: ReportSheetProps) {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const viewer = useSessionStore((state) => state.member?.username ?? null);
  const { report } = useSafety().useActions();

  const [flow, dispatchFlow] = useReducer(reportFlow, INITIAL_FLOW);
  const [failure, setFailure] = useState<ReportFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  /** One per report intent: kept across retries of the same text, renewed when the reason or the text changes. */
  const [key, setKey] = useState<{ key: string; details: string } | null>(null);
  const schema = useMemo(() => detailsSchema(flow.reason === 'illegal'), [flow.reason]);
  const { control, handleSubmit, reset, setError, formState } = useForm<DetailsValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { details: '' },
  });
  const details = useWatch({ control, name: 'details' });
  const busy = formState.isSubmitting;
  const done = flow.step === 'sent' || flow.step === 'duplicate';
  const dirty = !done && details.trim() !== '';

  const dispatch = (event: ReportFlowEvent) => {
    dispatchFlow(event);
    if (event.type === 'chooseReason' || event.type === 'chooseSubReason' || event.type === 'reset') {
      setKey(null);
      setFailure(null);
      setNotice(null);
    }
  };

  // Every opening starts clean: a half-written report never waits for the next target.
  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (visible) {
      dispatchFlow({ type: 'reset' });
      setFailure(null);
      setNotice(null);
      setDiscarding(false);
      setKey(null);
    }
  }
  useEffect(() => {
    if (!visible) reset({ details: '' });
  }, [reset, visible]);

  const guest = status === 'guest';
  const title = guest ? t('report.guestTitle') : stepTitle(t, flow.step);
  useEffect(() => {
    if (visible && flow.step !== 'reason' && !isWeb) AccessibilityInfo.announceForAccessibility(title);
  }, [flow.step, title, visible]);

  const send = handleSubmit(async (values) => {
    const input = buildReportInput(target, flow, values.details);
    if (!input) return;
    setFailure(null);
    setNotice(null);
    const text = input.details ?? '';
    const intent = key && key.details === text ? key.key : newIdempotencyKey();
    setKey({ key: intent, details: text });
    try {
      await report(input, intent);
      dispatch({ type: 'sent' });
    } catch (error) {
      const kind = reportFailure(error);
      if (kind === 'duplicate') {
        dispatch({ type: 'duplicate' });
        return;
      }
      setFailure(kind);
      // A 422 lands on the field when it names one; otherwise the server's own words, or the plain line.
      if (kind === 'invalid') {
        const unmapped = applyServerErrors(error, setError, { details: 'details' });
        setNotice(unmapped === null ? null : unmapped || t('report.failure.invalid'));
        return;
      }
      setNotice(t(`report.failure.${kind}`));
    }
  });

  const requestClose = () => {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };

  const offer = done ? blockOffer(target, viewer, blocked) : null;
  const handle = offer ? `@${offer}` : '';

  let content;
  let footer;
  if (guest) {
    content = <GuestStep testID={testID} onLeave={onClose} />;
  } else if (flow.step === 'reason') {
    content = (
      <View style={styles.body}>
        <Text variant="supporting" color="text.secondary" testID={`${testID}.target`}>
          {t('report.target', { label: target.label })}
        </Text>
        <View style={styles.rows} role="list">
          {REPORT_REASONS.map((reason, index) => (
            <View key={reason} role="listitem">
              <ListRow
                title={t(`report.reasons.${reason}`)}
                subtitle={t(`report.reasonHints.${reason}`)}
                role="button"
                inset={0}
                divider={index < REPORT_REASONS.length - 1}
                onPress={() => dispatch({ type: 'chooseReason', reason })}
                testID={`${testID}.reason.${reason}`}
              />
            </View>
          ))}
        </View>
      </View>
    );
  } else if (flow.step === 'subReason') {
    content = (
      <View style={[styles.body, styles.rows]} role="list">
        {ILLEGAL_SUB_REASONS.map((subReason, index) => (
          <View key={subReason} role="listitem">
            <ListRow
              title={t(`report.subReasons.${subReason}`)}
              subtitle={t(`report.subReasonHints.${subReason}`)}
              role="button"
              inset={0}
              divider={index < ILLEGAL_SUB_REASONS.length - 1}
              onPress={() => dispatch({ type: 'chooseSubReason', subReason })}
              testID={`${testID}.subReason.${subReason}`}
            />
          </View>
        ))}
      </View>
    );
    footer = <Button label={t('report.back')} variant="tertiary" size="l" fullWidth onPress={() => dispatch({ type: 'back' })} testID={`${testID}.back`} />;
  } else if (flow.step === 'details') {
    const reasonLabel = flow.reason ? t(`report.reasons.${flow.reason}`) : '';
    const subLabel = flow.subReason ? t(`report.subReasons.${flow.subReason}`) : null;
    const illegal = flow.reason === 'illegal';
    const blockedBy = failure !== null && !isRetryable(failure);
    content = (
      <View style={styles.body}>
        <View style={styles.chosen}>
          <View style={styles.chosenText}>
            <Text variant="caption" color="text.tertiary">
              {t('report.chosen')}
            </Text>
            <Text variant="bodyStrong" testID={`${testID}.chosen`}>
              {subLabel ? `${reasonLabel} · ${subLabel}` : reasonLabel}
            </Text>
          </View>
          <Button
            label={t('report.change')}
            accessibilityLabel={t('report.changeLabel')}
            variant="tertiary"
            size="s"
            disabled={busy}
            onPress={() => dispatch({ type: 'reset' })}
            testID={`${testID}.change`}
          />
        </View>
        {target.type === 'message' ? (
          <FormNotice tone="info" message={t('report.messageNote', { count: MESSAGE_CONTEXT_SIZE })} testID={`${testID}.messageNote`} />
        ) : null}
        {online ? null : <FormNotice tone="info" message={t('report.offline')} testID={`${testID}.offline`} />}
        {notice ? <FormNotice message={notice} testID={`${testID}.notice`} /> : null}
        <Controller
          control={control}
          name="details"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              label={t(illegal ? 'report.detailsLabelIllegal' : 'report.detailsLabel')}
              helper={`${t(illegal ? 'report.detailsHelperIllegal' : 'report.detailsHelper')} ${t('report.count', {
                used: formatNumber(field.value.length),
                max: formatNumber(DETAILS_MAX_LENGTH),
              })}`}
              error={
                fieldState.error
                  ? fieldState.error.type === 'server'
                    ? fieldState.error.message
                    : fieldState.error.message === 'report.detailsRequired'
                      ? t('report.detailsRequired', { min: formatNumber(DETAILS_MIN_ILLEGAL) })
                      : t('report.tooLong', { max: formatNumber(DETAILS_MAX_LENGTH) })
                  : undefined
              }
              multiline
              maxRows={6}
              disabled={busy}
              testID={`${testID}.details`}
            />
          )}
        />
        {illegal ? (
          <Text variant="caption" color="text.secondary" testID={`${testID}.goodFaith`}>
            {t('report.goodFaith')}
          </Text>
        ) : null}
      </View>
    );
    footer = (
      <View style={styles.footer}>
        <Button
          label={t(failure && isRetryable(failure) ? 'report.retry' : 'report.send')}
          size="l"
          fullWidth
          loading={busy}
          disabled={!online || blockedBy || Boolean(formState.errors.details && formState.errors.details.type !== 'server')}
          onPress={() => void send()}
          testID={`${testID}.send`}
        />
        <Button label={t('report.back')} variant="tertiary" size="l" fullWidth disabled={busy} onPress={() => dispatch({ type: 'back' })} testID={`${testID}.back`} />
      </View>
    );
  } else {
    const duplicate = flow.step === 'duplicate';
    content = (
      <View style={styles.body} role="status" testID={`${testID}.${duplicate ? 'duplicate' : 'sent'}`}>
        <View style={styles.done}>
          <Icon name="check" size={24} color="text.primary" />
          <Text variant="body" color="text.secondary">
            {t(duplicate ? 'report.duplicateBody' : 'report.sentBody')}
          </Text>
        </View>
        {offer && onBlock ? (
          <View style={styles.offer} testID={`${testID}.blockOffer`}>
            <Hairline style={styles.rule} />
            <Text variant="bodyStrong" role="heading" {...({ 'aria-level': 3 } as object)}>
              {t('report.blockOfferTitle')}
            </Text>
            <Text variant="bodyDense" color="text.secondary">
              {t('report.blockOfferBody')}
            </Text>
            <Button
              label={t('report.blockOffer', { name: handle })}
              variant="secondary"
              size="m"
              onPress={() => {
                onClose();
                onBlock(offer);
              }}
              testID={`${testID}.blockOffer.block`}
            />
          </View>
        ) : null}
      </View>
    );
    footer = (
      <View style={styles.footer}>
        <Button label={t('report.done')} size="l" fullWidth onPress={onClose} testID={`${testID}.done`} />
        <Button
          label={t('report.toStatus')}
          variant="tertiary"
          size="l"
          fullWidth
          role="link"
          onPress={() => {
            onClose();
            router.push(REPORTS_PATH);
          }}
          testID={`${testID}.toStatus`}
        />
      </View>
    );
  }

  return (
    <>
      <Sheet
        visible={visible}
        onClose={requestClose}
        title={title}
        dismissable={!busy}
        expandable={flow.step === 'details'}
        footer={footer}
        testID={testID}
      >
        {content}
      </Sheet>
      <Dialog
        visible={visible && discarding}
        onClose={() => setDiscarding(false)}
        title={t('report.discardTitle')}
        body={t('report.discardBody')}
        testID={`${testID}.discard`}
        actions={[
          { label: t('report.discardKeep'), variant: 'secondary', onPress: () => setDiscarding(false), testID: `${testID}.discard.keep` },
          {
            label: t('report.discardConfirm'),
            destructive: true,
            onPress: () => {
              setDiscarding(false);
              onClose();
            },
            testID: `${testID}.discard.confirm`,
          },
        ]}
      />
    </>
  );
}

function stepTitle(t: TFunction<'safety'>, step: ReportStep): string {
  switch (step) {
    case 'reason':
      return t('report.reasonTitle');
    case 'subReason':
      return t('report.subReasonTitle');
    case 'details':
      return t('report.detailsTitle');
    case 'sent':
      return t('report.sentTitle');
    case 'duplicate':
      return t('report.duplicateTitle');
  }
}

/**
 * A guest on the member web (contract §5): sign in or sign up, as the auth sheet offers, and the web form WEB-09 for a report without
 * an account. On native the guest gets the shared auth sheet instead (useReport), and the report opens after the sign-in.
 */
function GuestStep({ testID, onLeave }: { testID: string; onLeave: () => void }) {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const params = isInternalPath(pathname) ? { returnTo: pathname } : {};
  const go = (to: '/sign-in' | '/sign-up') => {
    onLeave();
    router.push({ pathname: to, params });
  };
  return (
    <View style={styles.body} testID={`${testID}.guest`}>
      <Text variant="body" color="text.secondary">
        {t('report.guestBody')}
      </Text>
      <Button label={t('report.guestSignIn')} size="l" fullWidth onPress={() => go('/sign-in')} testID={`${testID}.guest.signIn`} />
      <Button label={t('report.guestSignUp')} variant="secondary" size="l" fullWidth onPress={() => go('/sign-up')} testID={`${testID}.guest.signUp`} />
      {isWeb ? (
        <View style={styles.offer}>
          <Hairline style={styles.rule} />
          <Text variant="bodyDense" color="text.secondary">
            {t('report.guestWebFormHint')}
          </Text>
          <Button
            label={t('report.guestWebForm')}
            variant="tertiary"
            size="m"
            role="link"
            href={WEB_REPORT_FORM_PATH}
            flush="start"
            testID={`${testID}.guest.webForm`}
          />
        </View>
      ) : null}
    </View>
  );
}

