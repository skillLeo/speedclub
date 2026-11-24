import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { ApiError } from '@/api/client';
import { useSetBuildGoal, type BuildGoal } from '@/api/queries/insights';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { RadioRows } from '@/features/settings/components/SettingRows';
import { now } from '@/lib/clock';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { RowGroup } from '@/ui/RowGroup';

import { berlinYear, firstGoalSeason, goalSeasons, optimisticGoal } from '../model';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[8] },
}));

/** "none" or a year, as the radio rows hold it. */
const NONE = 'none';

/** Contract §4.1: a season from this year to ten years ahead, a stored past season unchanged, or none. */
export function goalSchema(year: number, stored: number | null) {
  return z.object({
    season: z
      .number()
      .int()
      .nullable()
      .refine((value) => value === null || value === stored || (value >= year && value <= year + 10), 'range'),
  });
}
export type GoalValues = { season: number | null };

export type BuildGoalSheetProps = {
  vehicle: Pick<PublicVehicle, 'id' | 'slug'>;
  goal: BuildGoal | null;
  visible: boolean;
  onClose: () => void;
  testID: string;
};

/**
 * "Ziel: Saison 2027" (10 §6.2, contract §4.1): the owner picks a season or none; Speichern sends `build_goal_season` through the
 * vehicle PATCH. No reminder and no countdown follow from it (no pressure). React Hook Form + Zod, the server's 422 on the field, and
 * "Änderungen verwerfen?" when a changed choice would be closed away.
 */
export function BuildGoalSheet({ vehicle, goal, visible, onClose, testID }: BuildGoalSheetProps) {
  const { t } = useTranslation('profile');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const update = useSetBuildGoal(vehicle);
  const today = now();
  const year = berlinYear(today);
  const first = firstGoalSeason(today);
  const stored = goal?.season ?? null;
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<GoalValues>({
    resolver: zodResolver(goalSchema(year, stored)),
    defaultValues: { season: stored },
  });
  const season = useWatch({ control, name: 'season' });
  const busy = formState.isSubmitting;
  const dirty = season !== stored;

  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (visible) {
      setNotice(null);
      setDiscarding(false);
    }
  }
  useEffect(() => {
    if (visible) reset({ season: stored });
  }, [reset, stored, visible]);

  const submit = handleSubmit(async ({ season: next }) => {
    setNotice(null);
    try {
      await update.mutateAsync({ season: next, goal: optimisticGoal(next, year, next === null ? '' : t('insights.goal.label', { season: next })) });
      toast(next === null ? t('insights.goal.cleared') : t('insights.goal.saved', { season: next }), { haptic: 'success', testID: `${testID}.toast` });
      onClose();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setNotice(t('insights.goal.failed'));
        return;
      }
      const unmapped = applyServerErrors(error, setError, { build_goal_season: 'season' });
      if (unmapped) setNotice(unmapped);
    }
  });

  const requestClose = () => {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };

  // DQ-P5-035 c: "Kein Ziel" first (a car without a goal opens on it, chosen), then the seasons from the first one still ahead.
  const options = [
    { value: NONE, label: t('insights.goal.none') },
    ...goalSeasons(year, stored, first).map((value) => ({
      value: String(value),
      label: t('insights.goal.season', { season: value }),
      helper: value < year ? t('insights.goal.passedHelper') : undefined,
    })),
  ];

  return (
    <>
      <Sheet
        visible={visible}
        onClose={requestClose}
        title={t('insights.goal.sheetTitle')}
        dismissable={!busy}
        testID={testID}
        footer={
          <Button
            label={t('insights.goal.save')}
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
            {t('insights.goal.intro')}
          </Text>
          {online ? null : <FormNotice tone="info" message={t('insights.goal.offline')} testID={`${testID}.offline`} />}
          {notice ? <FormNotice message={notice} testID={`${testID}.notice`} /> : null}
          <Controller
            control={control}
            name="season"
            render={({ field, fieldState }) => (
              <>
                <RowGroup testID={`${testID}.seasons`}>
                  <RadioRows<string>
                    label={t('insights.goal.sheetTitle')}
                    value={field.value === null ? NONE : String(field.value)}
                    onChange={(next) => field.onChange(next === NONE ? null : Number(next))}
                    disabled={busy}
                    options={options}
                    testID={`${testID}.season`}
                  />
                </RowGroup>
                {fieldState.error ? (
                  <FormNotice
                    message={fieldState.error.type === 'server' && fieldState.error.message ? fieldState.error.message : t('insights.goal.range')}
                    testID={`${testID}.error`}
                  />
                ) : null}
              </>
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
