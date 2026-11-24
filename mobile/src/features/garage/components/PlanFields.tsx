import { useState } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatMonthName, formatMonthYear } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { TextInput } from '@/ui/TextInput';
import { useStacksAtFontScale } from '@/ui/rowParts';

import { latestTargetMonth, TARGET_MONTH_MIN, type ModFormValues } from '../modForm';
import { fieldMessage } from '../schemas';
import { ChoiceChips, FormGroup, PickerField } from './fields';
import { OptionSheet } from './OptionSheet';

const useStyles = createStyles((t) => ({
  // Monat and Jahr side by side; at a large font one under the other, so "September" never breaks.
  pair: { flexDirection: 'row', gap: t.space[12] },
  pairStacked: { flexDirection: 'column' },
  half: { flex: 1, minWidth: 0 },
}));

const PRIORITIES = ['none', 'low', 'normal', 'high'] as const;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
/** The years the Jahr sheet lists: two back (an overdue plan) to the server's ten ahead; a stored year outside joins them. */
const YEARS_BACK = 2;

type Split = { year: number | null; month: number | null };

function split(value: string): Split {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : { year: null, month: null };
}

/** Mid-month in UTC, so the name is the same month in every time zone the formatter may use. */
function monthDate(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 15));
}

function join(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The month a choice of Monat or Jahr makes, with the other part filled sensibly when it is still empty: a month alone takes its
 * next occurrence from this month on, a year alone this month's number (exported for the tests).
 */
export function targetFrom(current: string, value: string, change: { month?: number; year?: number }): string {
  const now = split(current);
  const chosen = split(value);
  const nowYear = now.year ?? 0;
  const nowMonth = now.month ?? 1;
  const month = change.month ?? chosen.month ?? nowMonth;
  let year = change.year ?? chosen.year;
  if (year === null || year === undefined) year = month >= nowMonth ? nowYear : nowYear + 1;
  const next = join(year, month);
  const latest = latestTargetMonth(current);
  // Never past the server's range: a month after the tenth year's month moves back into it.
  return next > latest ? latest : next < TARGET_MONTH_MIN ? TARGET_MONTH_MIN : next;
}

export type PlanFieldsProps = {
  control: Control<ModFormValues>;
  /** This month in Europe/Berlin ("2026-11"). */
  month: string;
  disabled: boolean;
  routeId: string;
};

/**
 * M5.3 GAR-10 "Plan" (10 §5.9, contract §4.1), shown while the status is Geplant: Zielmonat as Monat + Jahr (past months allowed, up
 * to ten years ahead), Priorität (Keine · Niedrig · Normal · Hoch) and the private Budget ("Nur für dich sichtbar").
 */
export function PlanFields({ control, month, disabled, routeId }: PlanFieldsProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const stacked = useStacksAtFontScale();
  const [sheet, setSheet] = useState<'month' | 'year' | null>(null);
  const now = split(month);
  const nowYear = now.year ?? 0;
  const latestYear = split(latestTargetMonth(month)).year ?? nowYear;

  return (
    <FormGroup title={t('mods.groups.plan')} testID={`${routeId}.group.plan`}>
      <Controller
        control={control}
        name="targetMonth"
        render={({ field, fieldState }) => {
          const chosen = split(field.value);
          const years = Array.from({ length: latestYear - (nowYear - YEARS_BACK) + 1 }, (_, index) => nowYear - YEARS_BACK + index);
          if (chosen.year !== null && !years.includes(chosen.year)) years.unshift(chosen.year);
          const clear = field.value
            ? () => {
                field.onChange('');
                setSheet(null);
              }
            : undefined;
          const error = fieldMessage(t, fieldState.error);
          // "Ziel: März 2027" once both parts are set.
          const helper =
            chosen.month !== null && chosen.year !== null
              ? t('mods.targetChosen', { month: formatMonthYear(monthDate(chosen.year, chosen.month), format.locale) })
              : t('mods.targetHelper');
          return (
            <View>
              <View style={[styles.pair, stacked ? styles.pairStacked : null]} role="group" aria-label={t('mods.targetMonth')}>
                <View style={styles.half}>
                  <PickerField
                    label={t('mods.targetMonth')}
                    value={chosen.month === null ? null : formatMonthName(monthDate(2000, chosen.month), format.locale)}
                    placeholder={t('mods.targetMonthPlaceholder')}
                    onPress={() => setSheet('month')}
                    // DQ-M53-16: stacked at a large font, the helper goes under Jahr, so the two fields keep their gap.
                    helper={stacked ? undefined : helper}
                    error={stacked ? undefined : error}
                    disabled={disabled}
                    testID={`${routeId}.targetMonth`}
                  />
                </View>
                <View style={styles.half}>
                  <PickerField
                    label={t('mods.targetYear')}
                    value={chosen.year === null ? null : String(chosen.year)}
                    placeholder={t('mods.targetYearPlaceholder')}
                    onPress={() => setSheet('year')}
                    helper={stacked ? helper : undefined}
                    error={stacked ? error : undefined}
                    disabled={disabled}
                    testID={`${routeId}.targetYear`}
                  />
                </View>
              </View>
              <OptionSheet
                visible={sheet === 'month'}
                onClose={() => setSheet(null)}
                title={t('mods.targetMonth')}
                options={MONTHS.map((number) => ({ value: String(number), label: formatMonthName(monthDate(2000, number), format.locale) }))}
                value={chosen.month === null ? null : String(chosen.month)}
                onSelect={(option) => {
                  field.onChange(targetFrom(month, field.value, { month: Number(option.value) }));
                  field.onBlur();
                  setSheet(null);
                }}
                clearLabel={clear ? t('mods.targetClear') : undefined}
                onClear={clear}
                testID={`${routeId}.targetMonthSheet`}
              />
              <OptionSheet
                visible={sheet === 'year'}
                onClose={() => setSheet(null)}
                title={t('mods.targetYear')}
                options={years.map((year) => ({ value: String(year), label: String(year) }))}
                value={chosen.year === null ? null : String(chosen.year)}
                onSelect={(option) => {
                  field.onChange(targetFrom(month, field.value, { year: Number(option.value) }));
                  field.onBlur();
                  setSheet(null);
                }}
                clearLabel={clear ? t('mods.targetClear') : undefined}
                onClear={clear}
                testID={`${routeId}.targetYearSheet`}
              />
            </View>
          );
        }}
      />
      <Controller
        control={control}
        name="priority"
        render={({ field }) => (
          // Four choices, so chips (09 §5: a segmented control holds at most three): a radio group, "Keine" for none.
          <ChoiceChips
            label={t('mods.priority')}
            visibleLabel
            evenRows
            options={PRIORITIES.map((value) => ({ value, label: t(`mods.priorities.${value}`) }))}
            value={field.value === '' ? 'none' : field.value}
            onChange={(next) => field.onChange(next === 'none' || next === '' ? '' : next)}
            disabled={disabled}
            testID={`${routeId}.priority`}
          />
        )}
      />
      <BudgetField control={control} disabled={disabled} routeId={routeId} />
    </FormGroup>
  );
}

/**
 * The private Budget (10 §5.9, contract §2): in the Plan group while planned, and beside Kosten afterwards while the mod still has
 * one (the server keeps it once the plan is built, so the owner compares it with the cost and can clear it; review N7).
 */
export function BudgetField({ control, disabled, routeId }: Omit<PlanFieldsProps, 'month'>) {
  const { t } = useTranslation('garage');
  return (
    <Controller
      control={control}
      name="budget"
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          label={t('mods.budget')}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          placeholder={t('mods.budgetPlaceholder')}
          // 10 §5.9 / contract §2: the budget is the owner's alone, as the cost (09 §11).
          helper={t('mods.budgetPrivate')}
          suffix="€"
          error={fieldMessage(t, fieldState.error)}
          disabled={disabled}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={12}
          testID={`${routeId}.budget`}
        />
      )}
    />
  );
}
