import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, AI_MOD_TEXT_MAX, useSuggestMod, type ModSuggestion } from '@/api/queries/ai';
import type { ModCategoryField } from '@/api/queries/catalog';
import { formatNumber, type FormatLocale } from '@/lib/format';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, Hairline, Text, TextInput } from '@/ui';

import { AiLabel } from './AiLabel';
import { AiNote } from './AiNote';
import { aiNoteFor, hidesAiSurface, recordAiFailure, useAiAvailable, useAiDayEnd, type AiNoteState } from './availability';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  row: { gap: t.space[4] },
  actions: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
}));

export type SuggestedValue = string | number | boolean;

/** How a suggested value reads: the option's label, Ja/Nein, a number with its unit in the app's notation, or the text. */
export function suggestionText(field: Pick<ModCategoryField, 'type' | 'options' | 'unit'>, value: SuggestedValue, locale: FormatLocale, yesNo: [string, string]): string {
  if (typeof value === 'boolean') return value ? yesNo[0] : yesNo[1];
  if (field.options && typeof value === 'string') return field.options.find((option) => option.value === value)?.label ?? value;
  if (typeof value === 'number') return [formatNumber(value, locale, { maxFractionDigits: 2 }), field.unit].filter(Boolean).join(' ');
  return value;
}

/** The suggestion's fields this form has, in the form's order. */
export function suggestedRows(suggestion: ModSuggestion, fields: readonly ModCategoryField[]): { field: ModCategoryField; value: SuggestedValue }[] {
  return fields.flatMap((field) => {
    const value = suggestion.fields[field.key];
    return value === undefined || value === '' ? [] : [{ field, value }];
  });
}

export type ModAssistProps = {
  categoryKey: string;
  fields: readonly ModCategoryField[];
  locale: FormatLocale;
  disabled?: boolean;
  /** Puts one value into the form, not saved: the member saves with the form. */
  onAccept: (field: ModCategoryField, value: SuggestedValue) => void;
  testID: string;
};

/**
 * GAR-10 "Aus Text übernehmen" (M3.7 `ai.mod_assist`, flag + opt-in): the member pastes a text (an invoice line, a shop page), the
 * server suggests values for this category's fields only, and each is taken or discarded on its own, labelled "KI-Vorschlag".
 * Nothing is saved before the member saves the form. Used up for today (429 `ai_daily_limit`, 503 `ai_budget_exhausted`): the sentence
 * only, no "Vorschlagen" (code review phase-3-final SF-6).
 */
export function ModAssist({ categoryKey, fields, locale, disabled = false, onAccept, testID }: ModAssistProps) {
  const { t } = useTranslation('garage');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const available = useAiAvailable(AI_FLAGS.mods);
  const suggest = useSuggestMod();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<AiNoteState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [rows, setRows] = useState<{ field: ModCategoryField; value: SuggestedValue }[] | null>(null);
  const [label, setLabel] = useState('');
  const dayEnd = useAiDayEnd(AI_FLAGS.mods);
  if (!available || hidden) return null;
  const shownNote = dayEnd ?? note;

  if (!open && dayEnd) {
    return (
      <View style={styles.row} testID={testID}>
        <AiNote note={dayEnd} testID={testID} />
      </View>
    );
  }
  if (!open) {
    return (
      <Button
        label={t('ai.fromText')}
        icon="lightbulb"
        variant="tertiary"
        size="m"
        flush="start"
        disabled={disabled}
        onPress={() => setOpen(true)}
        testID={`${testID}.open`}
      />
    );
  }

  const run = () => {
    setNote(null);
    setRows(null);
    suggest.mutate(
      { categoryKey, text },
      {
        onSuccess: (suggestion) => {
          const found = suggestedRows(suggestion, fields);
          setLabel(suggestion.label);
          setRows(found);
          if (found.length === 0) setNote({ text: t('ai.nothingFound'), verify: false });
        },
        onError: (error) => {
          recordAiFailure(AI_FLAGS.mods, error);
          if (hidesAiSurface(error)) setHidden(true);
          setNote(aiNoteFor(common, error));
        },
      },
    );
  };
  const take = (row: { field: ModCategoryField; value: SuggestedValue }) => {
    onAccept(row.field, row.value);
    setRows((current) => current?.filter((item) => item.field.key !== row.field.key) ?? null);
  };
  const drop = (key: string) => setRows((current) => current?.filter((item) => item.field.key !== key) ?? null);
  const yesNo: [string, string] = [t('ai.yes'), t('ai.no')];

  return (
    <View style={styles.card} testID={testID}>
      <TextInput
        label={t('ai.pasteLabel')}
        helper={t('ai.pasteHelper')}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={AI_MOD_TEXT_MAX}
        testID={`${testID}.text`}
      />
      <View style={styles.actions}>
        {dayEnd ? null : (
          <Button
            label={t('ai.suggest')}
            variant="secondary"
            size="m"
            disabled={disabled || text.trim() === '' || !online}
            loading={suggest.isPending}
            onPress={run}
            testID={`${testID}.suggest`}
          />
        )}
        <Button label={common('ai.discard')} variant="tertiary" size="m" onPress={() => setOpen(false)} testID={`${testID}.close`} />
      </View>
      {shownNote ? <AiNote note={shownNote} testID={testID} /> : null}
      {rows && rows.length > 0 ? (
        <View style={styles.root} testID={`${testID}.rows`}>
          <AiLabel label={label} testID={`${testID}.label`} />
          {rows.map((row, index) => (
            <View key={row.field.key} style={styles.row} testID={`${testID}.row.${row.field.key}`}>
              {index > 0 ? <Hairline /> : null}
              <Text variant="callout" color="text.secondary">
                {row.field.label}
              </Text>
              <Text variant="bodyStrong">{suggestionText(row.field, row.value, locale, yesNo)}</Text>
              <View style={styles.actions}>
                <Button label={common('ai.accept')} variant="secondary" size="s" disabled={disabled} onPress={() => take(row)} testID={`${testID}.accept.${row.field.key}`} />
                <Button label={common('ai.discard')} variant="tertiary" size="s" onPress={() => drop(row.field.key)} testID={`${testID}.discard.${row.field.key}`} />
              </View>
            </View>
          ))}
          {rows.length > 1 ? (
            <Button
              label={common('ai.acceptAll')}
              variant="tertiary"
              size="m"
              flush="start"
              disabled={disabled}
              onPress={() => rows.forEach(take)}
              testID={`${testID}.acceptAll`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
