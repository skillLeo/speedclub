import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { formatNumber } from '@/lib/format';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, Dialog, Icon, Sheet, Text, TextInput } from '@/ui';

import { useSafety } from '../data';
import { APPEAL_MAX_LENGTH } from '../reportFlow';

const appealSchema = z.object({
  text: z.string().trim().min(1, 'appeal.required').max(APPEAL_MAX_LENGTH, 'report.tooLong'),
});
type AppealValues = z.infer<typeof appealSchema>;

export type AppealFailure = 'offline' | 'rate_limited' | 'duplicate' | 'expired' | 'invalid' | 'server';

/** What a failed `POST decisions/{id}/appeal` means (m2.6-api-handover §1). */
export function appealFailure(error: unknown): AppealFailure {
  if (!(error instanceof ApiError) || error.kind === 'network') return 'offline';
  if (error.kind === 'rate_limited') return 'rate_limited';
  // `idempotency_key_reused`: an appeal went in under this key already; SAFE-01 is asked again and shows it.
  if (error.code === 'appeal_exists' || error.code === 'idempotency_key_reused') return 'duplicate';
  if (error.code === 'appeal_period_over') return 'expired';
  if (error.kind === 'validation') return 'invalid';
  return 'server';
}

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  sent: { alignItems: 'flex-start', gap: t.space[12], paddingBottom: t.space[16] },
}));

export type AppealSheetProps = {
  visible: boolean;
  decisionId: string;
  onClose: () => void;
  /** The appeal went in, or the server says one already exists or the period is over: SAFE-01 loads the decision again. */
  onChanged: () => void;
  /** Whether the form holds text, for the screen's discard guard. */
  onDirtyChange?: (dirty: boolean) => void;
  testID: string;
};

/** SAFE-01 "Einspruch einlegen" (Art. 20 DSA): one text up to 2000 characters, then the sent state. */
export function AppealSheet({ visible, decisionId, onClose, onChanged, onDirtyChange, testID }: AppealSheetProps) {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const online = useOnline();
  const { appeal } = useSafety().useActions();
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  /** One per appeal intent: kept across retries of the same text, renewed when the text changes. */
  const [key, setKey] = useState<{ key: string; text: string } | null>(null);
  const { control, handleSubmit, reset, setError, formState } = useForm<AppealValues>({
    resolver: zodResolver(appealSchema),
    mode: 'onSubmit',
    defaultValues: { text: '' },
  });
  const text = useWatch({ control, name: 'text' });
  const busy = formState.isSubmitting;
  const dirty = !sent && text.trim() !== '';

  useEffect(() => onDirtyChange?.(visible && dirty), [dirty, onDirtyChange, visible]);

  // Every opening starts clean; the text goes when the sheet closes.
  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (visible) {
      setSent(false);
      setNotice(null);
      setDiscarding(false);
      setKey(null);
    }
  }
  useEffect(() => {
    if (!visible) reset({ text: '' });
  }, [reset, visible]);

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    const text = values.text.trim();
    const intent = key && key.text === text ? key.key : newIdempotencyKey();
    setKey({ key: intent, text });
    try {
      await appeal(decisionId, text, intent);
      setSent(true);
      onChanged();
    } catch (error) {
      const kind = appealFailure(error);
      if (kind === 'invalid') {
        const unmapped = applyServerErrors(error, setError, { text: 'text' });
        if (unmapped) setNotice(unmapped);
        return;
      }
      setNotice(t(`appeal.failure.${kind}`));
      if (kind === 'duplicate' || kind === 'expired') onChanged();
    }
  });

  const requestClose = () => {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };

  return (
    <>
      <Sheet
        visible={visible}
        onClose={requestClose}
        title={sent ? t('appeal.sentTitle') : t('appeal.title')}
        dismissable={!busy}
        expandable={!sent}
        testID={testID}
        footer={
          sent ? (
            <Button label={t('appeal.done')} size="l" fullWidth onPress={onClose} testID={`${testID}.done`} />
          ) : (
            <Button
              label={t('appeal.send')}
              size="l"
              fullWidth
              loading={busy}
              disabled={!online}
              onPress={() => void submit()}
              testID={`${testID}.send`}
            />
          )
        }
      >
        {sent ? (
          <View style={styles.sent} role="status" testID={`${testID}.sent`}>
            <Icon name="check" size={24} color="text.primary" />
            <Text variant="body" color="text.secondary">
              {t('appeal.sentBody')}
            </Text>
          </View>
        ) : (
          <View style={styles.body}>
            <Text variant="bodyDense" color="text.secondary">
              {t('appeal.body')}
            </Text>
            {online ? null : <FormNotice tone="info" message={t('report.offline')} testID={`${testID}.offline`} />}
            {notice ? <FormNotice message={notice} testID={`${testID}.notice`} /> : null}
            <Controller
              control={control}
              name="text"
              render={({ field, fieldState }) => (
                <TextInput
                  ref={field.ref}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  label={t('appeal.label')}
                  helper={t('report.count', { used: formatNumber(field.value.length), max: formatNumber(APPEAL_MAX_LENGTH) })}
                  error={
                    fieldState.error
                      ? fieldState.error.type === 'server'
                        ? fieldState.error.message
                        : fieldState.error.message === 'appeal.required'
                          ? t('appeal.required')
                          : t('report.tooLong', { max: formatNumber(APPEAL_MAX_LENGTH) })
                      : undefined
                  }
                  multiline
                  maxRows={8}
                  disabled={busy}
                  testID={`${testID}.text`}
                />
              )}
            />
          </View>
        )}
      </Sheet>
      <Dialog
        visible={visible && discarding}
        onClose={() => setDiscarding(false)}
        title={t('appeal.discardTitle')}
        body={t('appeal.discardBody')}
        testID={`${testID}.discard`}
        actions={[
          { label: t('appeal.discardKeep'), variant: 'secondary', onPress: () => setDiscarding(false), testID: `${testID}.discard.keep` },
          {
            label: t('appeal.discardConfirm'),
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
