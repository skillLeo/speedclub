import { useMemo, useState } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Brand, ModCategoryField } from '@/api/queries/catalog';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { ListRow, TextInput } from '@/ui';

import { BRAND_MAX_LENGTH, TEXT_MAX_LENGTH, unitOf, type LayoutRow, type ModFormValues } from '../modForm';
import { fieldMessage } from '../schemas';
import { FieldPair, PickerField, SwitchRow } from './fields';
import { filterOptions, OptionSheet } from './OptionSheet';

const SUGGESTIONS = 5;
const NUMBER_MAX_LENGTH = 7;

const useStyles = createStyles((t) => ({
  suggestions: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.sm, marginTop: -t.space[8], overflow: 'hidden' },
  field: { gap: t.space[8] },
}));

/** "2553519" or "255/35R19" → "255/35 R19", the tyre size of §3.9, while typing. */
export function maskTyre(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 7);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}/${digits.slice(3)}`;
  return `${digits.slice(0, 3)}/${digits.slice(3, 5)} R${digits.slice(5)}`;
}

const isTyreSize = (field: ModCategoryField) => field.key.startsWith('tyre_size');

type InputProps = {
  field: ModCategoryField;
  control: Control<ModFormValues>;
  brands: readonly Brand[];
  disabled: boolean;
  routeId: string;
};

/** A brand field with the catalogue's suggestions under it while typing (FS-6 "catalogue autocomplete"); any text stays valid. */
function BrandInput({ field, control, brands, disabled, routeId }: InputProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const options = useMemo(() => brands.map((brand) => ({ value: String(brand.id), label: brand.name })), [brands]);
  return (
    <Controller
      control={control}
      name={`fields.${field.key}`}
      render={({ field: input, fieldState }) => {
        const text = typeof input.value === 'string' ? input.value : '';
        const matches = focused && text.trim().length > 0 ? filterOptions(options, text).filter((option) => option.label !== text.trim()).slice(0, SUGGESTIONS) : [];
        return (
          <View style={styles.field}>
            <TextInput
              ref={input.ref}
              label={field.label}
              value={text}
              onChangeText={input.onChange}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                // A tap on a suggestion lands before the field loses focus.
                setTimeout(() => setFocused(false), 150);
                input.onBlur();
              }}
              placeholder={t('mods.brandPlaceholder')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              autoCorrect={false}
              maxLength={BRAND_MAX_LENGTH}
              testID={`${routeId}.field.${field.key}`}
            />
            {matches.length > 0 ? (
              <View role="list" aria-label={t('mods.suggestions', { field: field.label })} style={styles.suggestions} testID={`${routeId}.field.${field.key}.suggestions`}>
                {/* A list holds list items (axe aria-required-children); the row inside stays the button. */}
                {matches.map((option, index) => (
                  <View key={option.value} role="listitem">
                    <ListRow
                      title={option.label}
                      role="button"
                      chevron={false}
                      onPress={() => {
                        input.onChange(option.label);
                        setFocused(false);
                      }}
                      inset={space[16]}
                      divider={index < matches.length - 1}
                      testID={`${routeId}.field.${field.key}.suggestion.${option.value}`}
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

function SelectInput({ field, control, disabled, routeId }: InputProps) {
  const { t } = useTranslation('garage');
  const [open, setOpen] = useState(false);
  const options = (field.options ?? []).map((option) => ({ value: option.value, label: option.label }));
  return (
    <Controller
      control={control}
      name={`fields.${field.key}`}
      render={({ field: input, fieldState }) => {
        const value = typeof input.value === 'string' ? input.value : '';
        return (
          <>
            <PickerField
              label={field.label}
              value={options.find((option) => option.value === value)?.label ?? null}
              placeholder={t('specs.choose')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              onPress={() => setOpen(true)}
              testID={`${routeId}.field.${field.key}`}
            />
            <OptionSheet
              visible={open}
              onClose={() => setOpen(false)}
              title={field.label}
              options={options}
              value={value || null}
              onSelect={(option) => input.onChange(option.value)}
              clearLabel={field.required ? undefined : t('specs.noAnswer')}
              onClear={field.required ? undefined : () => input.onChange('')}
              testID={`${routeId}.field.${field.key}.sheet`}
            />
          </>
        );
      }}
    />
  );
}

function TextOrNumberInput({ field, control, disabled, routeId }: InputProps) {
  const { t } = useTranslation('garage');
  const format = useFormat();
  const number = field.type === 'number';
  const tyre = isTyreSize(field);
  return (
    <Controller
      control={control}
      name={`fields.${field.key}`}
      render={({ field: input, fieldState }) => (
        <TextInput
          ref={input.ref}
          label={field.label}
          value={typeof input.value === 'string' ? input.value : ''}
          onChangeText={(text) => input.onChange(tyre ? maskTyre(text) : text)}
          onBlur={input.onBlur}
          placeholder={field.key === 'bolt_pattern' ? t('mods.boltPatternPlaceholder') : field.example ?? (number && field.min !== null && field.max !== null ? t('mods.rangePlaceholder', { min: format.number(field.min), max: format.number(field.max) }) : undefined)}
          suffix={number ? unitOf(field) : undefined}
          error={fieldMessage(t, fieldState.error)}
          disabled={disabled}
          keyboardType={number ? (field.min !== null && field.min < 0 ? 'numbers-and-punctuation' : 'decimal-pad') : tyre ? 'number-pad' : 'default'}
          inputMode={number ? 'decimal' : tyre ? 'numeric' : 'text'}
          autoCorrect={false}
          maxLength={number ? NUMBER_MAX_LENGTH : tyre ? 10 : TEXT_MAX_LENGTH}
          testID={`${routeId}.field.${field.key}`}
        />
      )}
    />
  );
}

function FieldInput(props: InputProps) {
  if (props.field.type === 'brand') return <BrandInput {...props} />;
  if (props.field.type === 'select') return <SelectInput {...props} />;
  return <TextOrNumberInput {...props} />;
}

/** One row of the category's layout: a field, a front/rear pair side by side, or a switch (FS-6 "Mischbereifung"). */
export function ModFieldRow({ row, control, brands, disabled, routeId }: { row: LayoutRow; control: Control<ModFormValues>; brands: readonly Brand[]; disabled: boolean; routeId: string }) {
  if (row.kind === 'switch') {
    return (
      <Controller
        control={control}
        name={`fields.${row.field.key}`}
        render={({ field: input }) => (
          <SwitchRow label={row.field.label} value={input.value === true} onChange={input.onChange} disabled={disabled} testID={`${routeId}.field.${row.field.key}`} />
        )}
      />
    );
  }
  if (row.kind === 'pair') {
    return (
      <FieldPair testID={`${routeId}.pair.${row.fields[0].key}`}>
        {[
          <FieldInput key={row.fields[0].key} field={row.fields[0]} control={control} brands={brands} disabled={disabled} routeId={routeId} />,
          <FieldInput key={row.fields[1].key} field={row.fields[1]} control={control} brands={brands} disabled={disabled} routeId={routeId} />,
        ]}
      </FieldPair>
    );
  }
  return <FieldInput field={row.field} control={control} brands={brands} disabled={disabled} routeId={routeId} />;
}
