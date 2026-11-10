import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useUpdateVehicle, type GarageVehicle } from '@/api/queries/garage';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { useOnline } from '@/state/online';
import { TextInput, toast } from '@/ui';
import { DescriptionAssist } from '@/features/ai/DescriptionAssist';

import { useCharCount, FormGroup } from '../../components/fields';
import { RestrictedNotice } from '../../components/frames';
import { usePhotoCounts, VehiclePhotos } from '../../components/VehiclePhotos';
import { WizardFrame } from '../../components/WizardFrame';
import { saveErrorMessage } from '../../errors';
import { laterStep } from '../../model';
import { useCloseModal, wizardPath } from '../../navigation';
import { DESCRIPTION_MAX_LENGTH, descriptionSchema, fieldMessage } from '../../schemas';
import { useMountedRef, usePreview, useWizardDraft } from '../../wizard';
import { WizardStateBody } from './WizardStateBody';

const DESCRIPTION_ROWS = 6;

type Values = { description: string };

/** GAR-03 step 3 "Fotos & Beschreibung": at least one photo, the cover, up to 500 characters (F2). */
export function WizardPhotosScreen() {
  const wizard = useWizardDraft();
  const preview = usePreview(wizard.draft);
  if (wizard.state !== 'ready' || !wizard.draft) {
    const state = wizard.state === 'ready' ? 'gone' : wizard.state;
    return (
      <WizardFrame
        step="photos"
        draftId={wizard.draftId}
        reached={wizard.reached}
        preview={preview}
        ready={false}
        still={state === 'loading'}
        bare={state === 'gone'}
        dirty={false}
      >
        <WizardStateBody
          state={state}
          step="photos"
          draftId={wizard.draftId}
          onRetry={() => void wizard.query.refetch()}
          retrying={wizard.query.isFetching}
        />
      </WizardFrame>
    );
  }
  return <PhotosStep key={wizard.draft.id} draft={wizard.draft} reached={wizard.reached} restriction={wizard.restriction} />;
}

function PhotosStep({ draft, reached, restriction }: { draft: GarageVehicle; reached: number; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  const online = useOnline();
  const close = useCloseModal();
  const charCount = useCharCount();
  const mounted = useMountedRef();
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const update = useUpdateVehicle(draft.id);
  const counts = usePhotoCounts(draft);
  const preview = usePreview(draft);
  const { control, handleSubmit, setError, reset, setValue, formState } = useForm<Values>({
    resolver: zodResolver(descriptionSchema),
    mode: 'onTouched',
    defaultValues: { description: draft.description ?? '' },
  });
  const { isDirty } = formState;
  const description = useWatch({ control, name: 'description' });
  const locked = restriction !== null;
  const hasPhoto = counts.ready > 0 || counts.pending;

  useEffect(() => {
    if (leaving) close();
  }, [close, leaving]);

  const persist = async (values: Values, advance: boolean): Promise<boolean> => {
    setNotice(null);
    const step = laterStep(draft.wizard?.step, advance ? 'review' : 'photos');
    const patch = {
      ...(isDirty ? { description: values.description.trim() || null } : {}),
      ...(step !== (draft.wizard?.step ?? 1) ? { wizard_step: step } : {}),
    };
    try {
      if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
      reset(values);
      return true;
    } catch (error) {
      setNotice(applyServerErrors(error, setError, { description: 'description' }) === null ? null : saveErrorMessage(t, error));
      return false;
    }
  };

  const next = handleSubmit(async (values) => {
    if (!hasPhoto) {
      setNotice(t('wizard.photoRequired'));
      return;
    }
    if ((await persist(values, true)) && mounted.current) router.push(wizardPath(draft.id, 'review'));
  });
  const saveDraft = handleSubmit(async (values) => {
    if (!(await persist(values, false))) return;
    toast(t('wizard.draftSaved'), { testID: 'GAR-03.toast' });
    setLeaving(true);
  });

  return (
    <WizardFrame
      step="photos"
      draftId={draft.id}
      reached={reached}
      preview={preview}
      dirty={isDirty && !update.isPending && !leaving}
      cta={{ label: t('wizard.next'), onPress: () => void next(), loading: update.isPending, disabled: locked || !online }}
      secondary={{ label: t('wizard.saveDraft'), onPress: () => void saveDraft(), disabled: locked || !online || update.isPending, testID: 'GAR-03.photos.saveDraft' }}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID="GAR-03.restricted" /> : null}
      {notice ? <FormNotice message={notice} testID="GAR-03.notice" /> : null}
      <FormGroup title={t('wizard.photosGroup')}>
        {/* A photo the server could not process shows here too, as on GAR-07, instead of vanishing from the count (BH-46). */}
        <VehiclePhotos vehicle={draft} disabled={!online} locked={locked} failedPhotos={draft.failed_photos} routeId="GAR-03" />
      </FormGroup>
      <FormGroup>
        <Controller
          control={control}
          name="description"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('basics.description')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('basics.descriptionPlaceholder')}
              helper={charCount(description.length, DESCRIPTION_MAX_LENGTH)}
              error={fieldMessage(t, fieldState.error)}
              disabled={locked}
              multiline
              maxRows={DESCRIPTION_ROWS}
              maxLength={DESCRIPTION_MAX_LENGTH}
              testID="GAR-03.description"
            />
          )}
        />
        {/* M3.7 "Beschreibung vorschlagen": editable text in the field, labelled until edited, saved only with "Weiter". */}
        <DescriptionAssist
          vehicleId={draft.id}
          value={description}
          disabled={locked}
          onSuggest={(text) => setValue('description', text, { shouldDirty: true, shouldValidate: true })}
          testID="GAR-03.ai"
        />
      </FormGroup>
    </WizardFrame>
  );
}
