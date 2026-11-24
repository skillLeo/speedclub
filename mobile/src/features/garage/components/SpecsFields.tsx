import { useState } from 'react';
import { Controller, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { useStacksAtFontScale } from '@/ui/rowParts';
import { metaLineText } from '@/ui/textBreaks';

import { ASPIRATIONS, DRIVETRAINS, FUELS, GEARBOXES, markedSpecs, POWER_UNITS, powerCounterpart, SOURCES, type SpecMarkKey, type SpecsMarks, type SpecsValues } from '../model';
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

const NO_MARKS: SpecsMarks = {};

export type SpecsFieldsProps = {
  control: Control<SpecsValues>;
  disabled?: boolean;
  routeId: string;
  /**
   * M5.9 "Daten übernehmen?": the taken-over factory values (stored `ai_fields` and the ones just taken); a field still showing its
   * value has "Herstellerangabe (KI-Vorschlag)" under it until the member changes it.
   */
  marks?: SpecsMarks;
};

/**
 * FS-5 Technik, also GAR-06: MOTOR (Motorcode, Motor, Hubraum cm³, Kraftstoff, Aufladung), LEISTUNG (value with PS · kW · hp,
 * provenance chips, live "≈ 368 kW"), DREHMOMENT (Nm with provenance), ANTRIEB (Front · Heck · Allrad, Getriebe). The value
 * is stored as entered, in its unit (§3.2).
 */
export function SpecsFields({ control, disabled = false, routeId, marks = NO_MARKS }: SpecsFieldsProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const stacked = useStacksAtFontScale();
  const [picker, setPicker] = useState<PickerName | null>(null);
  const powerValue = useWatch({ control, name: 'powerValue' });
  const powerUnit = useWatch({ control, name: 'powerUnit' });
  const counterpart = powerCounterpart(powerValue, powerUnit, format.locale);
  const current = useWatch({ control });
  const marked = markedSpecs(current, marks);
  const sourceOptions = SOURCES.map((value) => ({ value, label: t(`specs.source.${value}`) }));
  const provenance = (key: SpecMarkKey): string | undefined => (marked.includes(key) ? t('ai.specs.provenance') : undefined);
  // DQ-P5-053: the line breaks after its "·", never inside the provenance label ("Herstellerangabe (KI-Vorschlag)" stays one label).
  const powerParts = [counterpart, provenance('powerValue')].filter((part): part is string => Boolean(part));
  const powerHelper = powerParts.length > 0 ? metaLineText(powerParts.join(' · ')) : undefined;

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
              helper={provenance('engineCode')}
              hyphenateHelper={false}
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
              helper={provenance('displacement')}
              hyphenateHelper={false}
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
                helper={provenance('fuel')}
                hyphenateHelper={false}
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
                helper={provenance('aspiration')}
                hyphenateHelper={false}
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
                  helper={powerHelper}
                  hyphenateHelper={false}
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
              helper={provenance('torque')}
              hyphenateHelper={false}
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
        {marked.includes('drivetrain') ? (
          <Text variant="caption" color="text.secondary" hyphenate={false} testID={`${routeId}.drivetrain.provenance`}>
            {t('ai.specs.provenance')}
          </Text>
        ) : null}
        <Controller
          control={control}
          name="gearbox"
          render={({ field, fieldState }) => (
            <>
              <PickerField
                label={t('specs.gearbox')}
                value={field.value ? t(`specs.gearboxes.${field.value}`) : null}
                placeholder={t('specs.choose')}
                helper={provenance('gearbox')}
                hyphenateHelper={false}
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
