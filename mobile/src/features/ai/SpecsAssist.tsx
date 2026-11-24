import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, useSuggestSpecs, type SpecSubject, type SpecSuggestion, type SpecVariant } from '@/api/queries/ai';
import type { GarageVehicle } from '@/api/queries/garage';
import { suggestedSpecs, takeSuggestion, type SpecsMarks, type SpecsValues } from '@/features/garage/model';
import type { TakenSuggestion } from '@/features/garage/specsSuggestion';
import { formatNumber, keepNameTogether, keepShortNamesTogether, parseNumber, type FormatLocale } from '@/lib/format';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Radio } from '@/ui/Radio';
import { Text } from '@/ui/Text';
import { metaLineText, vehicleNameText } from '@/ui/textBreaks';

import { AiLabel } from './AiLabel';
import { AiNote } from './AiNote';
import { quietAiNote, recordAiFailure, useAiAvailable, useAiDayEnd, type QuietAiNote } from './availability';

const useStyles = createStyles((t) => ({
  root: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  head: { gap: t.space[4] },
  titleRow: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[2] },
  variants: { gap: t.space[4] },
  variant: { gap: t.space[2] },
  // Under the label: a box-wide spacer plus the control's own 12 gap, so the text starts where the label does.
  variantPreviewRow: { columnGap: t.space[12], flexDirection: 'row' },
  variantPreviewSpacer: { width: t.size.checkbox },
  variantPreview: { flexShrink: 1 },
  // 24: the tertiary "Nein danke" is flush (it gives up its 16 inset so it lines up when it wraps), which leaves an 8 gap between the boxes.
  actions: { alignItems: 'center', columnGap: t.space[24], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
}));

/** "Nein danke" holds for the vehicle while the app runs: going back and forth between the steps does not ask again. */
const declined = new Set<string>();

/** Tests only. */
export function resetSpecsAssistForTests(): void {
  declined.clear();
}

/** The catalogue car the suggestion is for: its generation, or the model and year when the member chose no generation. */
export function specSubject(vehicle: Pick<GarageVehicle, 'generation_id' | 'model_id' | 'model_year'>): SpecSubject | null {
  if (vehicle.generation_id) return { generation_id: vehicle.generation_id };
  if (vehicle.model_id && vehicle.model_year) return { model_id: vehicle.model_id, model_year: vehicle.model_year };
  return null;
}

export type SpecsAssistProps = {
  vehicle: Pick<GarageVehicle, 'id' | 'generation_id' | 'model_id' | 'model_year'>;
  /** Whether the stored specs leave a field to fill; a complete set gets no question. */
  open: boolean;
  /** The form's values at the moment of "Übernehmen": only their empty fields are filled. */
  getValues: () => SpecsValues;
  onTake: (taken: TakenSuggestion) => void;
  locale: FormatLocale;
  /** The button that saves, named in the hint ("Weiter", "Speichern"). */
  saveLabel: string;
  disabled?: boolean;
  testID: string;
};

/**
 * GAR-03 step 2 and GAR-06 "Daten übernehmen?" (M5.9 `ai.vehicle_specs`, 10 §8.1; flag + "KI-Vorschläge"): one quiet block above the
 * fields. "Ja" asks for the typical factory specs of the catalogue car (catalogue names only leave for the provider, never the
 * member's data); one variant or a choice of up to six by label; "Übernehmen" fills the empty fields only, editable, marked
 * "Herstellerangabe (KI-Vorschlag)" until changed, saved with the form. Label text only, no icon (10 §8). "Nein danke" hides it.
 */
export function SpecsAssist({ vehicle, open, getValues, onTake, locale, saveLabel, disabled = false, testID }: SpecsAssistProps) {
  const { t } = useTranslation('garage');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const available = useAiAvailable(AI_FLAGS.specs);
  const dayEnd = useAiDayEnd(AI_FLAGS.specs);
  const suggest = useSuggestSpecs();
  const [answer, setAnswer] = useState<SpecSuggestion | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState<QuietAiNote | null>(null);
  const [state, setState] = useState<'ask' | 'hidden' | 'done'>(() => (declined.has(vehicle.id) ? 'hidden' : 'ask'));
  const subject = specSubject(vehicle);
  if (!available || !open || subject === null || state !== 'ask') return null;

  const fetchSuggestion = () => {
    setNote(null);
    suggest.mutate(subject, {
      onSuccess: (next) => {
        if (next.variants.length === 0) {
          setNote({ text: common('ai.errors.noSuggestion'), verify: false, retry: false });
          return;
        }
        setAnswer(next);
        setChoice(next.variants.length === 1 ? (next.variants[0]?.key ?? null) : null);
      },
      onError: (error) => {
        recordAiFailure(AI_FLAGS.specs, error);
        const quiet = quietAiNote(common, error);
        if (quiet === null) setState('hidden');
        else setNote(quiet);
      },
    });
  };

  const decline = () => {
    declined.add(vehicle.id);
    setState('hidden');
  };

  const variant = answer?.variants.find((item) => item.key === choice) ?? null;
  const take = () => {
    if (!answer || !variant) return;
    const values = takeSuggestion(getValues(), suggestedSpecs(variant.fields, locale));
    if (Object.keys(values).length === 0) {
      setNote({ text: t('ai.specs.allFilled'), verify: false, retry: false });
      return;
    }
    onTake({ cacheId: answer.cache_id, variant: variant.key, values });
    setState('done');
  };

  const shownNote = dayEnd ? { ...dayEnd, retry: false } : note;
  const ended = dayEnd !== null || (note !== null && !note.retry && answer === null);
  const label = answer?.label ?? t('ai.specs.label');

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" role="heading" {...({ 'aria-level': 2 } as object)} testID={`${testID}.title`}>
            {t('ai.specs.question')}
          </Text>
          <AiLabel label={label} testID={`${testID}.label`} />
        </View>
        <Text variant="callout" color="text.secondary" testID={`${testID}.intro`}>
          {answer ? t('ai.specs.for', { subject: vehicleNameText(answer.subject) }) : t('ai.specs.intro')}
        </Text>
      </View>

      {answer && answer.variants.length > 1 ? (
        <View role="radiogroup" aria-label={t('ai.specs.variants')} style={styles.variants} testID={`${testID}.variants`}>
          {answer.variants.map((item) => (
            <VariantOption
              key={item.key}
              variant={item}
              checked={item.key === choice}
              onChoose={() => setChoice(item.key)}
              locale={locale}
              disabled={disabled}
              testID={`${testID}.variant.${item.key}`}
            />
          ))}
        </View>
      ) : answer && variant ? (
        // DQ-P5-067: a code in the name ("RB26DETT") never hyphenates; the name keeps its hyphens whole, as the radio label does.
        <Text variant="callout" hyphenate={false} testID={`${testID}.preview`}>
          {metaLineText(
            [keepShortNamesTogether(variant.label), ...specsPreviewParts(t, suggestedSpecs(variant.fields, locale), locale)].filter(Boolean).join(' · '),
          )}
        </Text>
      ) : null}

      {answer ? (
        <Text variant="caption" color="text.secondary" testID={`${testID}.hint`}>
          {t('ai.specs.hint', { save: saveLabel })}
        </Text>
      ) : null}

      {shownNote ? <AiNote note={shownNote} variant="callout" testID={testID} /> : null}

      <View style={styles.actions}>
        {ended ? null : answer ? (
          <Button
            label={common('ai.accept')}
            variant="secondary"
            size="m"
            disabled={disabled || variant === null}
            onPress={take}
            testID={`${testID}.take`}
          />
        ) : (
          <Button
            label={note?.retry ? t('ai.retry') : t('ai.specs.yes')}
            variant="secondary"
            size="m"
            disabled={disabled || !online}
            loading={suggest.isPending}
            onPress={fetchSuggestion}
            testID={`${testID}.ask`}
          />
        )}
        <Button label={t('ai.specs.no')} variant="tertiary" size="m" flush="start" onPress={decline} testID={`${testID}.decline`} />
      </View>
    </View>
  );
}

function VariantOption({
  variant,
  checked,
  onChoose,
  locale,
  disabled,
  testID,
}: {
  variant: SpecVariant;
  checked: boolean;
  onChoose: () => void;
  locale: FormatLocale;
  disabled: boolean;
  testID: string;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const preview = specsPreview(t, suggestedSpecs(variant.fields, locale), locale);
  return (
    <View style={styles.variant}>
      <Radio checked={checked} onChange={onChoose} label={keepNameTogether(variant.label)} showLabel alignFirstLine disabled={disabled} testID={testID} />
      {preview ? (
        <View style={styles.variantPreviewRow}>
          <View style={styles.variantPreviewSpacer} />
          <Text variant="caption" color="text.secondary" style={styles.variantPreview} testID={`${testID}.preview`}>
            {preview}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const NBSP = '\u00A0';

/** "2302" → "2.302 cm³" in German: the locale's grouping, the unit bound to the figure (skill §9, DQ-P5-054). */
function figure(text: string, unit: string, locale: FormatLocale): string {
  const value = parseNumber(text, locale);
  return `${Number.isFinite(value) ? formatNumber(value, locale, { maxFractionDigits: 2 }) : text}${NBSP}${unit}`;
}

/** The parts of a variant's preview, in the form's words: "150 PS", "330 Nm", "Diesel", "Heck", "Schaltgetriebe". */
export function specsPreviewParts(t: TFunction, values: SpecsMarks, locale: FormatLocale): string[] {
  const parts: string[] = [];
  if (values.powerValue && values.powerUnit) parts.push(figure(values.powerValue, t(`units.${values.powerUnit}`), locale));
  if (values.torque) parts.push(figure(values.torque, t('units.nm'), locale));
  if (values.displacement) parts.push(figure(values.displacement, t('units.cc'), locale));
  if (values.fuel) parts.push(t(`specs.fuels.${values.fuel}`));
  if (values.drivetrain) parts.push(t(`specs.drivetrains.${values.drivetrain}`));
  if (values.gearbox) parts.push(t(`specs.gearboxes.${values.gearbox}`));
  return parts;
}

/**
 * "150 PS · 330 Nm · Diesel · Heck · Schaltgetriebe": what a variant would fill, as a meta line that wraps after a "·" first and
 * never between a figure and its unit (DQ-P5-059).
 */
export function specsPreview(t: TFunction, values: SpecsMarks, locale: FormatLocale): string {
  const parts = specsPreviewParts(t, values, locale);
  return parts.length > 0 ? metaLineText(parts.join(' · ')) : '';
}
