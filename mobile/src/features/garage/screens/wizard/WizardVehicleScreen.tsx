import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useCreateVehicle, useUpdateVehicleById, useVehicle, type VehicleAttributes } from '@/api/queries/garage';
import { myVehiclesKey, useMyVehicles, type VehicleCardData } from '@/api/queries/profile';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { now } from '@/lib/clock';
import { useOnline } from '@/state/online';
import { EmptyState, toast } from '@/ui';

import { FormSkeleton, RestrictedNotice } from '../../components/frames';
import { useBasicsCatalogueLoading, VehicleBasicsFields } from '../../components/VehicleBasicsFields';
import { WizardFrame } from '../../components/WizardFrame';
import { useCreateOnce } from '../../createOnce';
import { saveErrorMessage } from '../../errors';
import { basicsPatch, basicsPatchOver, basicsValues, laterStep, VEHICLE_LIMIT, type BasicsValues } from '../../model';
import { useCloseModal, wizardPath } from '../../navigation';
import { basicsSchema, maxModelYear, yearIssue } from '../../schemas';
import { useMountedRef, usePreview, useWizardDraft } from '../../wizard';
import { WizardStateBody } from './WizardStateBody';

/** Server field → form field. A level's id and its free text are one field here. */
export const BASICS_FIELDS = {
  make_id: 'make',
  make_text: 'make',
  model_id: 'model',
  model_text: 'model',
  generation_id: 'generation',
  model_year: 'year',
  nickname: 'nickname',
  color: 'color',
  description: 'description',
} as const;

type Wizard = ReturnType<typeof useWizardDraft>;

/** GAR-03 step 1 "Fahrzeug": make → model → generation → year from the catalogue, or free text. Creates the draft. */
export function WizardVehicleScreen() {
  const wizard = useWizardDraft();
  const preview = usePreview(wizard.draft);
  const catalogueLoading = useBasicsCatalogueLoading(wizard.draft?.model_id);
  const state = wizard.state === 'ready' && catalogueLoading ? 'loading' : wizard.state;
  if (state !== 'ready') {
    return (
      <WizardFrame
        step="vehicle"
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
          step="vehicle"
          draftId={wizard.draftId}
          onRetry={() => void wizard.query.refetch()}
          retrying={wizard.query.isFetching}
        />
      </WizardFrame>
    );
  }
  return <VehicleStep key={wizard.draft?.id ?? 'new'} wizard={wizard} />;
}

function VehicleStep({ wizard }: { wizard: Wizard }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  const online = useOnline();
  const close = useCloseModal();
  const client = useQueryClient();
  const mounted = useMountedRef();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // The limit counts drafts too. A full garage in the cache is checked against the server before anything is asked for: a form
  // whose every save is known to be refused is no form, so a garage that is still full gets its blocking state (GAR-03.limit).
  const garage = useMyVehicles();
  const [limit, setLimit] = useState<'none' | 'checking' | 'full'>(() =>
    wizard.isNew && (client.getQueryData<VehicleCardData[]>(myVehiclesKey)?.length ?? 0) >= VEHICLE_LIMIT ? 'checking' : 'none',
  );
  const refetchGarage = garage.refetch;
  useEffect(() => {
    if (limit !== 'checking') return;
    let live = true;
    // Offline or failed, the cached list stands; the server still decides on the save.
    void refetchGarage().then((result) => {
      if (live) setLimit((result.data?.length ?? 0) >= VEHICLE_LIMIT ? 'full' : 'none');
    });
    return () => {
      live = false;
    };
  }, [limit, refetchGarage]);
  const id = wizard.isNew ? createdId : wizard.draftId;
  const create = useCreateVehicle();
  const createOnce = useCreateOnce((body: VehicleAttributes, idempotencyKey: string) => create.mutateAsync({ body, idempotencyKey }));
  const update = useUpdateVehicleById();
  // After going back, the route of a new draft is still add-vehicle/new: the mark is the created draft's, never lower (BH-18).
  const created = useVehicle(wizard.isNew ? (createdId ?? undefined) : undefined);
  const mark = (wizard.draft ?? created.data)?.wizard?.step;
  const maxYear = maxModelYear(now());
  const schema = useMemo(() => basicsSchema(maxYear), [maxYear]);
  const { control, handleSubmit, setValue, setError, clearErrors, reset, getValues, formState } = useForm<BasicsValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: basicsValues(wizard.draft),
  });
  const { isDirty, dirtyFields } = formState;
  const make = useWatch({ control, name: 'make' });
  const model = useWatch({ control, name: 'model' });
  const year = useWatch({ control, name: 'year' });
  const preview = usePreview(wizard.draft, {
    title: [make?.name, model?.name].filter(Boolean).join(' ') || t('wizard.untitled'),
    subtitle: year || undefined,
  });
  const pending = create.isPending || update.isPending;
  const locked = wizard.restriction !== null;

  // Leaves only after the saved values are the form's, so the discard guard stays quiet.
  useEffect(() => {
    if (leaving) close();
  }, [close, leaving]);

  /** Saves what the form holds. Returns the draft's id, or null when the save failed. */
  const persist = async (values: BasicsValues, step: number): Promise<string | null> => {
    setNotice(null);
    let creating = !id;
    try {
      let target = id;
      let current = mark;
      let replayed: VehicleAttributes | null = null;
      if (!target) {
        const { result, stale, sent } = await createOnce({ ...basicsPatch(values, 'all'), wizard_step: step });
        setCreatedId(result.id);
        if (!stale) {
          reset(values);
          return result.id;
        }
        // The draft holds what the lost attempt sent; what differs from it now goes on top, a field emptied since included.
        creating = false;
        target = result.id;
        current = result.wizard?.step;
        replayed = sent;
      }
      const patch = replayed ? basicsPatchOver(values, replayed) : basicsPatch(values, dirtyFields);
      const wizardStep = laterStep(current, step === 1 ? 'vehicle' : 'specs');
      if (wizardStep !== (current ?? 1)) patch.wizard_step = wizardStep;
      if (Object.keys(patch).length > 0) await update.mutateAsync({ id: target, body: patch });
      reset(values);
      return target;
    } catch (error) {
      setNotice(applyServerErrors(error, setError, BASICS_FIELDS) === null ? null : saveErrorMessage(t, error, { creating }));
      return null;
    }
  };

  const next = handleSubmit(async (values) => {
    const saved = await persist(values, 2);
    if (saved && mounted.current) router.push(wizardPath(saved, 'specs'));
  });

  const saveDraft = async () => {
    const values = getValues();
    if (!id && !values.make && !values.model && !values.year) {
      setLeaving(true);
      return;
    }
    // A draft stays lenient about what is missing, not about a year the server would refuse.
    const yearProblem = values.year.trim() === '' ? null : yearIssue(values.year, maxYear);
    if (yearProblem) {
      setError('year', { type: 'custom', message: yearProblem }, { shouldFocus: true });
      return;
    }
    clearErrors('year');
    const saved = await persist(values, 1);
    if (!saved) return;
    toast(t('wizard.draftSaved'), { testID: 'GAR-03.toast' });
    setLeaving(true);
  };

  if (limit !== 'none') {
    return (
      <WizardFrame
        step="vehicle"
        draftId={wizard.draftId}
        reached={wizard.reached}
        preview={preview}
        ready={false}
        still={limit === 'checking'}
        bare={limit === 'full'}
        dirty={false}
      >
        {limit === 'checking' ? (
          <FormSkeleton routeId="GAR-03" groups={[4]} />
        ) : (
          <EmptyState
            icon="garage"
            title={t('wizard.limitTitle')}
            body={t('wizard.limitReached')}
            action={{
              label: t('wizard.limitAction'),
              onPress: () => {
                close();
                router.navigate('/garage');
              },
              variant: 'secondary',
              size: 'm',
            }}
            testID="GAR-03.limit"
          />
        )}
      </WizardFrame>
    );
  }

  return (
    <WizardFrame
      step="vehicle"
      draftId={id ?? wizard.draftId}
      reached={mark ?? wizard.reached}
      preview={preview}
      dirty={isDirty && !pending && !leaving}
      cta={{ label: t('wizard.next'), onPress: () => void next(), loading: pending, disabled: locked || !online }}
      secondary={{ label: t('wizard.saveDraft'), onPress: () => void saveDraft(), disabled: locked || !online || pending, testID: 'GAR-03.vehicle.saveDraft' }}
    >
      {locked && wizard.restriction ? <RestrictedNotice message={wizard.restriction} testID="GAR-03.restricted" /> : null}
      {notice ? <FormNotice message={notice} testID="GAR-03.notice" /> : null}
      <VehicleBasicsFields control={control} setValue={setValue} maxYear={maxYear} disabled={locked} routeId="GAR-03" />
    </WizardFrame>
  );
}
