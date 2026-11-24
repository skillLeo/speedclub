import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { ApiError } from '@/api/client';
import { STORY_LINE_MAX, useUpdateCarOfTheDayStory } from '@/api/queries/carOfTheDay';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { qa } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[8] },
}));

/**
 * DQ-P5G-28: the field grows with the line up to its 140 characters, which take about six lines at 200 %, so the last word is
 * never hidden behind the field's edge; one row to spare for German breaks.
 */
const STORY_MAX_ROWS = 7;

/** Contract §3: one line, at most 140 characters; empty clears it. */
export const storySchema = z.object({ story: z.string().trim().max(STORY_LINE_MAX, 'tooLong') });
export type StoryValues = z.infer<typeof storySchema>;

export type CarOfTheDayEditorProps = {
  visible: boolean;
  vehicleId: string;
  storyLine: string | null;
  onClose: () => void;
  testID: string;
};

/**
 * HOME-01 "Story bearbeiten" (contract §3, §8): the owner's one line under their Car of the Day, ≤ 140 characters, while the car is
 * featured. React Hook Form + Zod, the counter under the field, Speichern in the sheet's sticky footer above the keyboard, the
 * server's 422 (keyword rules) on the field, and "Änderungen verwerfen?" when a changed line would be closed away.
 */
export function CarOfTheDayEditor({ visible, vehicleId, storyLine, onClose, testID }: CarOfTheDayEditorProps) {
  const { t } = useTranslation('home');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const update = useUpdateCarOfTheDayStory(vehicleId);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<StoryValues>({
    resolver: zodResolver(storySchema),
    mode: 'onChange',
    defaultValues: { story: storyLine ?? '' },
  });
  const story = useWatch({ control, name: 'story' });
  const busy = formState.isSubmitting;
  const dirty = story.trim() !== (storyLine ?? '').trim();

  // Every opening starts from the line as it is now (the state during render, as AppealSheet does; the form in an effect).
  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (visible) {
      setNotice(null);
      setDiscarding(false);
    }
  }
  useEffect(() => {
    if (visible) reset({ story: storyLine ?? '' });
  }, [reset, storyLine, visible]);

  const submit = handleSubmit(async ({ story: next }) => {
    setNotice(null);
    // QA screenshots never send.
    if (qa.gift !== undefined) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(next);
      toast(t('carOfTheDay.saved'), { haptic: 'success', testID: `${testID}.toast` });
      onClose();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setNotice(t('carOfTheDay.failed'));
        return;
      }
      // 422 `story_line` (length, keyword rules) lands on the field; anything else is the form's notice.
      const unmapped = applyServerErrors(error, setError, { story_line: 'story' });
      if (unmapped) setNotice(unmapped);
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
        title={t('carOfTheDay.editorTitle')}
        dismissable={!busy}
        testID={testID}
        footer={
          <Button
            label={t('carOfTheDay.save')}
            size="l"
            fullWidth
            loading={busy}
            disabled={!online || !dirty}
            onPress={() => void submit()}
            testID={`${testID}.save`}
          />
        }
      >
        <View style={styles.body}>
          <Text variant="body" color="text.secondary">
            {t('carOfTheDay.editorIntro')}
          </Text>
          {online ? null : <FormNotice tone="info" message={t('carOfTheDay.offline')} testID={`${testID}.offline`} />}
          {notice ? <FormNotice message={notice} testID={`${testID}.notice`} /> : null}
          <Controller
            control={control}
            name="story"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('carOfTheDay.field')}
                placeholder={t('carOfTheDay.placeholder')}
                helper={t('carOfTheDay.counter', { count: format.number(field.value.length), max: format.number(STORY_LINE_MAX) })}
                error={
                  fieldState.error
                    ? fieldState.error.type === 'server'
                      ? fieldState.error.message
                      : t('carOfTheDay.tooLong', { max: format.number(STORY_LINE_MAX) })
                    : undefined
                }
                multiline
                maxRows={STORY_MAX_ROWS}
                disabled={busy}
                testID={`${testID}.story`}
              />
            )}
          />
        </View>
      </Sheet>
      <Dialog
        visible={visible && discarding}
        onClose={() => setDiscarding(false)}
        title={common('discard.title')}
        body={common('discard.body')}
        testID={`${testID}.discard`}
        actions={[
          { label: common('discard.keep'), variant: 'secondary', onPress: () => setDiscarding(false), testID: `${testID}.discard.keep` },
          {
            label: common('discard.confirm'),
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
