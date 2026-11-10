import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { GarageVehicle } from '@/api/queries/garage';
import { useSaveSpecs, useUpdateVehicle } from '@/api/queries/garage';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { toast } from '@/ui';

import { RestrictedNotice } from '../../components/frames';
import { SpecsFields } from '../../components/SpecsFields';
import { WizardFrame } from '../../components/WizardFrame';
import { saveErrorMessage } from '../../errors';
import { laterStep, specsRequest, specsValues, type SpecsValues } from '../../model';
import { useCloseModal, wizardPath } from '../../navigation';
import { specsSchema } from '../../schemas';
import { useSpecChips } from '../../specChips';
import { useMountedRef, usePreview, useWizardDraft } from '../../wizard';
import { WizardStateBody } from './WizardStateBody';

export const SPECS_FIELDS = {
  engine_code: 'engineCode',
  engine_text: 'engineText',
  displacement_cc: 'displacement',
  fuel: 'fuel',
  aspiration: 'aspiration',
  power_value: 'powerValue',
  power_unit: 'powerUnit',
  power_source: 'powerSource',
  torque_nm: 'torque',
  torque_source: 'torqueSource',
  drivetrain: 'drivetrain',
  gearbox: 'gearbox',
} as const;

/** GAR-03 step 2 "Technik", FS-5. Everything is optional; Weiter saves what is there. */
export function WizardSpecsScreen() {
  const wizard = useWizardDraft();
  const preview = usePreview(wizard.draft);
  if (wizard.state !== 'ready' || !wizard.draft) {
    const state = wizard.state === 'ready' ? 'gone' : wizard.state;
    return (
      <WizardFrame
        step="specs"
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
          step="specs"
          draftId={wizard.draftId}
          onRetry={() => void wizard.query.refetch()}
          retrying={wizard.query.isFetching}
        />
      </WizardFrame>
    );
  }
  return <SpecsStep key={wizard.draft.id} draft={wizard.draft} reached={wizard.reached} restriction={wizard.restriction} />;
}

function SpecsStep({ draft, reached, restriction }: { draft: GarageVehicle; reached: number; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  const online = useOnline();
  const format = useFormat();
  const close = useCloseModal();
  const mounted = useMountedRef();
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const saveSpecs = useSaveSpecs(draft.id);
  const update = useUpdateVehicle(draft.id);
  const schema = useMemo(() => specsSchema(format.locale), [format.locale]);
  // Fresh data reaches the fields the member has not touched: the PUT replaces the whole set, so a value another device saved
  // must not go back out as it was when the step opened (as SpecsForm, BH-10).
  const fresh = useMemo(() => specsValues(draft.specs, format.locale), [draft.specs, format.locale]);
  const { control, handleSubmit, setError, reset, formState } = useForm<SpecsValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: fresh,
    values: fresh,
    // keepDirty: without it the reset calls the form clean for a moment, and a tap on Weiter in that moment saves nothing.
    resetOptions: { keepDirtyValues: true, keepDirty: true },
  });
  const { isDirty } = formState;
  const values = useWatch({ control });
  const chips = useSpecChips(values);
  const preview = usePreview(draft, { specs: chips });
  const pending = saveSpecs.isPending || update.isPending;
  const locked = restriction !== null;

  useEffect(() => {
    if (leaving) close();
  }, [close, leaving]);

  const persist = async (form: SpecsValues, advance: boolean): Promise<boolean> => {
    setNotice(null);
    try {
      if (isDirty) await saveSpecs.mutateAsync(specsRequest(form, format.locale));
      const step = laterStep(draft.wizard?.step, advance ? 'photos' : 'specs');
      if (step !== (draft.wizard?.step ?? 1)) await update.mutateAsync({ wizard_step: step });
      reset(form);
      return true;
    } catch (error) {
      setNotice(applyServerErrors(error, setError, SPECS_FIELDS) === null ? null : saveErrorMessage(t, error));
      return false;
    }
  };

  const next = handleSubmit(async (form) => {
    if ((await persist(form, true)) && mounted.current) router.push(wizardPath(draft.id, 'photos'));
  });
  const saveDraft = handleSubmit(async (form) => {
    if (!(await persist(form, false))) return;
    toast(t('wizard.draftSaved'), { testID: 'GAR-03.toast' });
    setLeaving(true);
  });

  return (
    <WizardFrame
      step="specs"
      draftId={draft.id}
      reached={reached}
      preview={preview}
      dirty={isDirty && !pending && !leaving}
      cta={{ label: t('wizard.next'), onPress: () => void next(), loading: pending, disabled: locked || !online }}
      secondary={{ label: t('wizard.saveDraft'), onPress: () => void saveDraft(), disabled: locked || !online || pending, testID: 'GAR-03.specs.saveDraft' }}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID="GAR-03.restricted" /> : null}
      {notice ? <FormNotice message={notice} testID="GAR-03.notice" /> : null}
      <SpecsFields control={control} disabled={locked} routeId="GAR-03" />
    </WizardFrame>
  );
}
