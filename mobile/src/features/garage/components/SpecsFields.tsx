import { useState } from 'react';
import { Controller, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { SegmentedControl, Text, TextInput } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';

import { ASPIRATIONS, DRIVETRAINS, FUELS, GEARBOXES, POWER_UNITS, powerCounterpart, SOURCES, type SpecsValues } from '../model';
import { ENGINE_CODE_MAX_LENGTH, ENGINE_TEXT_MAX_LENGTH, fieldMessage } from '../schemas';
import { ChoiceChips, FormGroup, PickerField } from './fields';
import { OptionSheet } from './OptionSheet';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[24] },
  powerRow: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  powerInput: { flex: 1, minWidth: 0 },
  // A column like the field's: label, 8, then the 36 control centred in the field's 52.
  unitColumn: { flexBasis: '45%', flexGrow: 0, flexShrink: 0, gap: t.space[8] },
  unitBox: { justifyContent: 'center', minHeight: t.size.input },
  stacked: { gap: t.space[12] },
}));

type PickerName = 'fuel' | 'aspiration' | 'gearbox';

export type SpecsFieldsProps = {
  control: Control<SpecsValues>;
  disabled?: boolean;
  routeId: string;
};

/**
 * FS-5 Technik, also GAR-06: MOTOR (Motorcode, Motor, Hubraum cm³, Kraftstoff, Aufladung), LEISTUNG (value with PS · kW · hp,
 * provenance chips, live "≈ 368 kW"), DREHMOMENT (Nm with provenance), ANTRIEB (Front · Heck · Allrad, Getriebe). The value
 * is stored as entered, in its unit (§3.2).
 */
export function SpecsFields({ control, disabled = false, routeId }: SpecsFieldsProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const stacked = useStacksAtFontScale();
  const [picker, setPicker] = useState<PickerName | null>(null);
  const powerValue = useWatch({ control, name: 'powerValue' });
  const powerUnit = useWatch({ control, name: 'powerUnit' });
  const counterpart = powerCounterpart(powerValue, powerUnit, format.locale);
  const sourceOptions = SOURCES.map((value) => ({ value, label: t(`specs.source.${value}`) }));

  return (
    <View style={styles.groups}>
      <FormGroup title={t('specs.groups.engine')} testID={`${routeId}.group.engine`}>
        <Controller
          control={control}
          name="engineCode"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('specs.engineCode')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('specs.engineCodePlaceholder')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={ENGINE_CODE_MAX_LENGTH}
              testID={`${routeId}.engineCode`}
            />
          )}
        />
        <Controller
          control={control}
          name="engineText"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('specs.engine')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('specs.enginePlaceholder')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              maxLength={ENGINE_TEXT_MAX_LENGTH}
              testID={`${routeId}.engineText`}
            />
          )}
        />
        <Controller
          control={control}
          name="displacement"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('specs.displacement')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('specs.displacementPlaceholder')}
              suffix={t('units.cc')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={6}
              testID={`${routeId}.displacement`}
            />
          )}
        />
        <Controller
          control={control}
          name="fuel"
          render={({ field, fieldState }) => (
            <>
              <PickerField
                label={t('specs.fuel')}
                value={field.value ? t(`specs.fuels.${field.value}`) : null}
                placeholder={t('specs.choose')}
                error={fieldMessage(t, fieldState.error)}
                disabled={disabled}
                onPress={() => setPicker('fuel')}
                testID={`${routeId}.fuel`}
              />
              <OptionSheet
                visible={picker === 'fuel'}
                onClose={() => setPicker(null)}
                title={t('specs.fuel')}
                options={FUELS.map((value) => ({ value, label: t(`specs.fuels.${value}`) }))}
                value={field.value || null}
                onSelect={(option) => field.onChange(option.value)}
                clearLabel={t('specs.noAnswer')}
                onClear={() => field.onChange('')}
                testID={`${routeId}.fuelSheet`}
              />
            </>
          )}
        />
        <Controller
          control={control}
          name="aspiration"
          render={({ field, fieldState }) => (
            <>
              <PickerField
                label={t('specs.aspiration')}
                value={field.value ? t(`specs.aspirations.${field.value}`) : null}
                placeholder={t('specs.choose')}
                error={fieldMessage(t, fieldState.error)}
                disabled={disabled}
                onPress={() => setPicker('aspiration')}
                testID={`${routeId}.aspiration`}
              />
              <OptionSheet
                visible={picker === 'aspiration'}
                onClose={() => setPicker(null)}
                title={t('specs.aspiration')}
                options={ASPIRATIONS.map((value) => ({ value, label: t(`specs.aspirations.${value}`) }))}
                value={field.value || null}
                onSelect={(option) => field.onChange(option.value)}
                clearLabel={t('specs.noAnswer')}
                onClear={() => field.onChange('')}
                testID={`${routeId}.aspirationSheet`}
              />
            </>
          )}
        />
      </FormGroup>

      <FormGroup title={t('specs.groups.power')} testID={`${routeId}.group.power`}>
        <View style={stacked ? styles.stacked : styles.powerRow}>
          <View style={stacked ? null : styles.powerInput}>
            <Controller
              control={control}
              name="powerValue"
              render={({ field, fieldState }) => (
                <TextInput
                  ref={field.ref}
                  label={t('specs.power')}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={t('specs.powerPlaceholder')}
                  helper={counterpart ?? undefined}
                  error={fieldMessage(t, fieldState.error)}
                  disabled={disabled}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  maxLength={8}
                  testID={`${routeId}.powerValue`}
                />
              )}
            />
          </View>
          <View style={stacked ? styles.stacked : styles.unitColumn}>
            <Text variant="callout" color="text.secondary" aria-hidden>
              {t('specs.powerUnit')}
            </Text>
            <View style={stacked ? null : styles.unitBox}>
          <Controller
            control={control}
            name="powerUnit"
            render={({ field }) => (
              <SegmentedControl
                label={t('specs.powerUnit')}
                role="radiogroup"
                options={[
                  { value: POWER_UNITS[0], label: t('units.ps') },
                  { value: POWER_UNITS[1], label: t('units.kw') },
                  { value: POWER_UNITS[2], label: t('units.hp') },
                ]}
                value={field.value}
                onChange={field.onChange}
                disabled={disabled}
                testID={`${routeId}.powerUnit`}
              />
            )}
          />
            </View>
          </View>
        </View>
        <Controller
          control={control}
          name="powerSource"
          render={({ field }) => (
            <ChoiceChips
              label={t('specs.powerSource')}
              options={sourceOptions}
              value={field.value}
              onChange={field.onChange}
              disabled={disabled}
              evenRows
              testID={`${routeId}.powerSource`}
            />
          )}
        />
      </FormGroup>

      <FormGroup title={t('specs.groups.torque')} testID={`${routeId}.group.torque`}>
        <Controller
          control={control}
          name="torque"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              label={t('specs.torque')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('specs.torquePlaceholder')}
              suffix={t('units.nm')}
              error={fieldMessage(t, fieldState.error)}
              disabled={disabled}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              testID={`${routeId}.torque`}
            />
          )}
        />
        <Controller
          control={control}
          name="torqueSource"
          render={({ field }) => (
            <ChoiceChips
              label={t('specs.torqueSource')}
              options={sourceOptions}
              value={field.value}
              onChange={field.onChange}
              disabled={disabled}
              evenRows
              testID={`${routeId}.torqueSource`}
            />
          )}
        />
      </FormGroup>

      <FormGroup title={t('specs.groups.drivetrain')} testID={`${routeId}.group.drivetrain`}>
        <Controller
          control={control}
          name="drivetrain"
          render={({ field }) => (
            <SegmentedControl
              label={t('specs.drivetrain')}
              role="radiogroup"
              options={[
                { value: DRIVETRAINS[0], label: t('specs.drivetrains.front') },
                { value: DRIVETRAINS[1], label: t('specs.drivetrains.rear') },
                { value: DRIVETRAINS[2], label: t('specs.drivetrains.all') },
              ]}
              value={field.value}
              allowNone
              onChange={field.onChange}
              disabled={disabled}
              testID={`${routeId}.drivetrain`}
            />
          )}
        />
        <Controller
          control={control}
          name="gearbox"
          render={({ field, fieldState }) => (
            <>
              <PickerField
                label={t('specs.gearbox')}
                value={field.value ? t(`specs.gearboxes.${field.value}`) : null}
                placeholder={t('specs.choose')}
                error={fieldMessage(t, fieldState.error)}
                disabled={disabled}
                onPress={() => setPicker('gearbox')}
                testID={`${routeId}.gearbox`}
              />
              <OptionSheet
                visible={picker === 'gearbox'}
                onClose={() => setPicker(null)}
                title={t('specs.gearbox')}
                options={GEARBOXES.map((value) => ({ value, label: t(`specs.gearboxes.${value}`) }))}
                value={field.value || null}
                onSelect={(option) => field.onChange(option.value)}
                clearLabel={t('specs.noAnswer')}
                onClear={() => field.onChange('')}
                testID={`${routeId}.gearboxSheet`}
              />
            </>
          )}
        />
      </FormGroup>
    </View>
  );
}
