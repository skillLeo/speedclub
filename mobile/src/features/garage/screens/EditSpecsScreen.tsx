import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useFlag } from '@/api/queries/appConfig';
import { useSaveSpecs, useUpdateVehicle, type GarageVehicle } from '@/api/queries/garage';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { now } from '@/lib/clock';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { TextInput, toast } from '@/ui';

import { FormGroup } from '../components/fields';
import { EditorForm, EditorScreen, RestrictedNotice } from '../components/frames';
import { SpecsFields } from '../components/SpecsFields';
import { saveErrorMessage } from '../errors';
import { checkHuAu, formatCalendarDay, formatDueMonth, huAuState, huAuText, maskHuAu, reminderDay } from '../huAu';
import { specsRequest, specsValues, type SpecsValues } from '../model';
import { fieldMessage, issue, specsSchema } from '../schemas';
import { useOwnVehicle, useSessionHeld } from '../useOwnVehicle';
import { SPECS_FIELDS } from './wizard/WizardSpecsScreen';

const ROUTE = 'GAR-06';
export const HU_AU_FLAG = 'sig.hu_au_reminder';

type FormValues = SpecsValues & { huAu: string };

const HU_AU_ISSUES = { format: 'validation.huAuFormat', tooEarly: 'validation.huAuTooEarly', tooLate: 'validation.huAuTooLate' } as const;

/**
 * GAR-06 /garage/[id]/specs: the grouped spec form of FS-5 (PS · kW · hp, provenance). A change on a published vehicle makes a
 * build update. [SIG `sig.hu_au_reminder`] adds the HU/AU month: owner only, never public, with the reminder 30 days before.
 */
export function EditSpecsScreen() {
  const { t } = useTranslation('garage');
  const own = useOwnVehicle(ROUTE, { path: 'specs', skeleton: [5, 2, 1, 2] });
  return (
    <EditorScreen routeId={ROUTE} title={t('specs.title')} fallback={own.id ? `/garage/${own.id}` : '/garage'} offlineLabel={t('offline.editor')}>
      {own.state ?? (own.vehicle ? <SpecsForm key={own.vehicle.id} vehicle={own.vehicle} restriction={own.restriction} /> : null)}
    </EditorScreen>
  );
}

function SpecsForm({ vehicle, restriction }: { vehicle: GarageVehicle; restriction: string | null }) {
  const { t } = useTranslation('garage');
  const router = useRouter();
  const online = useOnline();
  const format = useFormat();
  const huAuEnabled = useFlag(HU_AU_FLAG);
  const save = useSaveSpecs(vehicle.id);
  const saveHuAu = useUpdateVehicle(vehicle.id);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The day the form opened: the bounds and the helper do not move while it is open.
  const [today] = useState(now);
  const schema = useMemo(
    () =>
      specsSchema(format.locale).extend({
        huAu: z.string().superRefine((value, context) => {
          const check = checkHuAu(value, today);
          if (!check.ok) context.addIssue({ code: 'custom', message: issue(HU_AU_ISSUES[check.reason]) });
        }),
      }),
    [format.locale, today],
  );
  // Fresh data reaches the fields the member has not touched, so a save never writes back what another device changed (BH-10).
  const fresh = useMemo<FormValues>(
    () => ({ ...specsValues(vehicle.specs, format.locale), huAu: huAuText(vehicle.hu_au_due) }),
    [format.locale, vehicle.hu_au_due, vehicle.specs],
  );
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: fresh,
    values: fresh,
    // keepDirty: without it the reset calls the form clean for a moment, and a tap on Speichern in that moment does nothing.
    resetOptions: { keepDirtyValues: true, keepDirty: true },
  });
  const { isDirty, dirtyFields } = formState;
  const locked = restriction !== null;
  // Behind a session that ended (BH-30) the fields keep the member's text in its own colour: nothing saves, nothing is lost.
  const held = useSessionHeld();
  const fieldsLocked = locked && !held;
  const pending = save.isPending || saveHuAu.isPending;

  useEffect(() => {
    if (!saved) return;
    if (router.canGoBack()) router.back();
    else router.replace(`/garage/${vehicle.id}?tab=specs`);
  }, [router, saved, vehicle.id]);

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    const { huAu, ...specs } = values;
    const specsDirty = Object.keys(dirtyFields).some((key) => key !== 'huAu');
    const huAuDirty = huAuEnabled && Boolean(dirtyFields.huAu);
    try {
      let history = false;
      if (specsDirty || !huAuDirty) history = (await save.mutateAsync(specsRequest(specs, format.locale))).history_recorded;
      if (huAuDirty) {
        const check = checkHuAu(huAu, today);
        // Through PATCH vehicles/{id}, which takes `hu_au_due` today (VehicleAttributesRequest).
        if (check.ok) await saveHuAu.mutateAsync({ hu_au_due: check.value });
      }
      toast(history ? t('editor.savedWithHistory') : t('editor.saved'), { haptic: 'success', testID: `${ROUTE}.saved` });
      setSaved(true);
    } catch (error) {
      setNotice(applyServerErrors(error, setError, { ...SPECS_FIELDS, hu_au_due: 'huAu' }) === null ? null : saveErrorMessage(t, error));
    }
  });

  return (
    <EditorForm
      routeId={ROUTE}
      dirty={isDirty && !pending && !saved}
      cta={{ label: t('editor.save'), onPress: () => void submit(), loading: pending, disabled: locked || !online || !isDirty }}
      revealTop={restriction ?? notice}
    >
      {locked && restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      {/* SpecsFields reads only the spec keys, which this form holds unchanged; the extra HU/AU key is invisible to it. */}
      <SpecsFields control={control as unknown as Control<SpecsValues>} disabled={fieldsLocked} routeId={ROUTE} />
      {huAuEnabled ? <HuAuField control={control} disabled={fieldsLocked} today={today} /> : null}
    </EditorForm>
  );
}

/** The HU/AU month with the reminder date it leads to, or what the due date means today. */
function HuAuField({ control, disabled, today }: { control: Control<FormValues>; disabled: boolean; today: Date }) {
  const { t } = useTranslation('garage');
  const format = useFormat();

  const helperFor = (text: string): string => {
    const check = checkHuAu(text, today);
    if (!check.ok || check.value === null) return t('specs.huAuHelperEmpty');
    const state = huAuState(check.value, today);
    if (state === 'overdue') return t('specs.huAuHelperOverdue', { month: formatDueMonth(check.value, format.locale) ?? text });
    if (state === 'dueNow') return t('specs.huAuHelperDue');
    if (state === 'reminderPassed') return t('specs.huAuHelperPassed');
    const day = reminderDay(check.value);
    return day ? t('specs.huAuHelper', { date: formatCalendarDay(day, format.locale) }) : t('specs.huAuHelperEmpty');
  };

  return (
    <FormGroup title={t('specs.groups.inspection')} testID={`${ROUTE}.group.inspection`}>
      <Controller
        control={control}
        name="huAu"
        render={({ field, fieldState }) => (
          <TextInput
            ref={field.ref}
            label={t('specs.huAu')}
            value={field.value}
            onChangeText={(text) => field.onChange(maskHuAu(text))}
            onBlur={field.onBlur}
            placeholder={t('specs.huAuPlaceholder')}
            helper={helperFor(field.value)}
            error={fieldMessage(t, fieldState.error)}
            disabled={disabled}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={7}
            testID={`${ROUTE}.huAu`}
          />
        )}
      />
    </FormGroup>
  );
}
