import { useState } from 'react';
import { Controller, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useGenerations, useMakes, useModels } from '@/api/queries/catalog';
import { createStyles } from '@/theme';
import { TextInput } from '@/ui';

import type { BasicsValues, CatalogChoice } from '../model';
import { COLOR_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, fieldMessage, NICKNAME_MAX_LENGTH } from '../schemas';
import { PickerField, useCharCount } from './fields';
import { OptionSheet, type SheetOption } from './OptionSheet';

const TEXT_MAX_LENGTH = 100;
const DESCRIPTION_ROWS = 6;

const useStyles = createStyles((t) => ({
  fields: { gap: t.space[16] },
}));

export type VehicleBasicsFieldsProps = {
  control: Control<BasicsValues>;
  setValue: UseFormSetValue<BasicsValues>;
  /** Make, model, generation and year always; the rest where the screen asks for them (GAR-05). */
  extras?: { nickname?: boolean; color?: boolean; description?: boolean };
  maxYear: number;
  disabled?: boolean;
  routeId: string;
};

type SheetName = 'make' | 'model' | 'generation';

function yearsOf(from: number | null, to: number | null): string | undefined {
  if (from === null) return undefined;
  return to === null ? `${from} – ` : `${from} – ${to}`;
}

/**
 * DQ-184: whether the form still waits for the stored model's generations. They decide whether the generation field shows at
 * all and what the year's helper says, so a form drawn before them would grow under the member's eyes. A request that failed
 * or waits for the network does not hold the form back; the field then says so in its sheet.
 *
 * It holds only the first time per model. The form's own observer refetches a failed query on mount, which puts a query
 * without data back to pending: waiting again would take the form away and start over, for as long as the request fails.
 */
export function useBasicsCatalogueLoading(modelId: number | null | undefined): boolean {
  const generations = useGenerations(modelId);
  const waiting = generations.isPending && generations.fetchStatus === 'fetching';
  const [settledFor, setSettledFor] = useState<number | null>(null);
  if (modelId && !waiting && settledFor !== modelId) setSettledFor(modelId);
  return Boolean(modelId) && settledFor !== modelId && waiting;
}

/**
 * Make → model → generation → year from the real catalogue (F2), each a sheet with search, and "Nicht gefunden?" as free
 * text, which the server files as a catalogue request itself (handover: do not call catalog/requests as well). A new make
 * clears model and generation, as the server does.
 */
export function VehicleBasicsFields({ control, setValue, extras = {}, maxYear, disabled = false, routeId }: VehicleBasicsFieldsProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const charCount = useCharCount();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const make = useWatch({ control, name: 'make' });
  const model = useWatch({ control, name: 'model' });
  const generation = useWatch({ control, name: 'generation' });
  const description = useWatch({ control, name: 'description' });

  const makes = useMakes();
  const models = useModels(make?.id ?? null);
  const generations = useGenerations(model?.id ?? null);

  const dirty = { shouldDirty: true, shouldValidate: true } as const;
  const chooseMake = (next: CatalogChoice) => {
    if (make && make.id === next.id && make.name === next.name) return;
    setValue('make', next, dirty);
    setValue('model', null, { shouldDirty: true });
    setValue('generation', null, { shouldDirty: true });
  };
  const chooseModel = (next: CatalogChoice) => {
    if (model && model.id === next.id && model.name === next.name) return;
    setValue('model', next, dirty);
    setValue('generation', null, { shouldDirty: true });
  };

  const makeOptions: SheetOption[] = (makes.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.name }));
  const modelOptions: SheetOption[] = (models.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.name }));
  const generationOptions: SheetOption[] = (generations.data ?? []).map((entry) => ({
    value: String(entry.id),
    label: entry.name,
    detail: yearsOf(entry.year_from, entry.year_to),
  }));
  const chosenGeneration = generations.data?.find((entry) => entry.id === generation?.id);
  const freeMake = make !== null && make.id === null;
  const showGeneration = !freeMake && model !== null && model.id !== null && (generations.isPending || generationOptions.length > 0);

  return (
    <View style={styles.fields}>
      <Controller
        control={control}
        name="make"
        render={({ fieldState }) => (
          <PickerField
            label={t('basics.make')}
            value={make?.name}
            placeholder={t('basics.makePlaceholder')}
            helper={freeMake ? t('basics.freeTextHelper') : undefined}
            error={fieldMessage(t, fieldState.error)}
            disabled={disabled}
            onPress={() => setSheet('make')}
            testID={`${routeId}.make`}
          />
        )}
      />
      <Controller
        control={control}
        name="model"
        render={({ field, fieldState }) =>
          freeMake ? (
            <TextInput
              ref={field.ref}
              label={t('basics.model')}
              value={model?.name ?? ''}
              onChangeText={(text) => setValue('model', text ? { id: null, name: text } : null, dirty)}
              onBlur={field.onBlur}
              placeholder={t('basics.modelPlaceholder')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              maxLength={TEXT_MAX_LENGTH}
              testID={`${routeId}.modelText`}
            />
          ) : (
            <PickerField
              label={t('basics.model')}
              value={model?.name}
              placeholder={make ? t('basics.modelPlaceholder') : t('basics.modelAfterMake')}
              helper={model && model.id === null ? t('basics.freeTextHelper') : undefined}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled || make === null}
              onPress={() => setSheet('model')}
              testID={`${routeId}.model`}
            />
          )
        }
      />
      {showGeneration ? (
        <PickerField
          label={t('basics.generation')}
          value={generation ? [generation.name, yearsOf(chosenGeneration?.year_from ?? null, chosenGeneration?.year_to ?? null)].filter(Boolean).join(' · ') : null}
          placeholder={t('basics.generationPlaceholder')}
          helper={t('basics.optional')}
          disabled={disabled}
          onPress={() => setSheet('generation')}
          testID={`${routeId}.generation`}
        />
      ) : null}
      <Controller
        control={control}
        name="year"
        render={({ field, fieldState }) => (
          <TextInput
            ref={field.ref}
            label={t('basics.year')}
            value={field.value}
            onChangeText={(text) => field.onChange(text.replace(/\D/g, '').slice(0, 4))}
            onBlur={field.onBlur}
            placeholder={chosenGeneration?.year_from ? String(chosenGeneration.year_from) : t('basics.yearPlaceholder')}
            helper={chosenGeneration ? t('basics.yearHelper', { name: chosenGeneration.name, years: yearsOf(chosenGeneration.year_from, chosenGeneration.year_to) ?? '' }) : undefined}
            error={fieldMessage(t, fieldState.error)}
            disabled={disabled}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            testID={`${routeId}.year`}
          />
        )}
      />
      {extras.nickname ? (
        <Controller
          control={control}
          name="nickname"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('basics.nickname')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('basics.nicknamePlaceholder')}
              helper={t('basics.nicknameHelper')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              maxLength={NICKNAME_MAX_LENGTH}
              testID={`${routeId}.nickname`}
            />
          )}
        />
      ) : null}
      {extras.color ? (
        <Controller
          control={control}
          name="color"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('basics.color')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('basics.colorPlaceholder')}
              helper={t('basics.optional')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              maxLength={COLOR_MAX_LENGTH}
              testID={`${routeId}.color`}
            />
          )}
        />
      ) : null}
      {extras.description ? (
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
              disabled={disabled}
              multiline
              maxRows={DESCRIPTION_ROWS}
              maxLength={DESCRIPTION_MAX_LENGTH}
              testID={`${routeId}.description`}
            />
          )}
        />
      ) : null}

      <OptionSheet
        visible={sheet === 'make'}
        onClose={() => setSheet(null)}
        title={t('basics.makeSheet')}
        options={makeOptions}
        value={make?.id === null ? null : String(make?.id ?? '')}
        onSelect={(option) => chooseMake({ id: Number(option.value), name: option.label })}
        searchPlaceholder={t('basics.makeSearch')}
        loading={makes.isPending && makes.fetchStatus !== 'idle'}
        error={makes.isError && !makes.data ? { onRetry: () => void makes.refetch(), retrying: makes.isFetching } : undefined}
        freeText={{
          label: t('catalog.notFound'),
          inputLabel: t('basics.make'),
          helper: t('catalog.notFoundHelper'),
          submitLabel: t('catalog.useText'),
          initial: freeMake ? make.name : '',
          maxLength: TEXT_MAX_LENGTH,
          onSubmit: (text) => chooseMake({ id: null, name: text }),
        }}
        testID={`${routeId}.makeSheet`}
      />
      <OptionSheet
        visible={sheet === 'model'}
        onClose={() => setSheet(null)}
        title={make ? t('basics.modelSheet', { make: make.name }) : t('basics.model')}
        options={modelOptions}
        value={model?.id === null ? null : String(model?.id ?? '')}
        onSelect={(option) => chooseModel({ id: Number(option.value), name: option.label })}
        searchPlaceholder={t('basics.modelSearch')}
        loading={models.isPending && models.fetchStatus !== 'idle'}
        error={models.isError && !models.data ? { onRetry: () => void models.refetch(), retrying: models.isFetching } : undefined}
        freeText={{
          label: t('catalog.notFound'),
          inputLabel: t('basics.model'),
          helper: t('catalog.notFoundHelper'),
          submitLabel: t('catalog.useText'),
          initial: model?.id === null ? model.name : '',
          maxLength: TEXT_MAX_LENGTH,
          onSubmit: (text) => chooseModel({ id: null, name: text }),
        }}
        testID={`${routeId}.modelSheet`}
      />
      <OptionSheet
        visible={sheet === 'generation'}
        onClose={() => setSheet(null)}
        title={t('basics.generationSheet')}
        options={generationOptions}
        value={generation ? String(generation.id) : null}
        onSelect={(option) => setValue('generation', { id: Number(option.value), name: option.label }, dirty)}
        loading={generations.isPending && generations.fetchStatus !== 'idle'}
        error={generations.isError && !generations.data ? { onRetry: () => void generations.refetch(), retrying: generations.isFetching } : undefined}
        clearLabel={t('basics.noGeneration')}
        onClear={() => setValue('generation', null, dirty)}
        testID={`${routeId}.generationSheet`}
      />
    </View>
  );
}
