import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, useSuggestDescription } from '@/api/queries/ai';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, Text, toast } from '@/ui';

import { AiLabel } from './AiLabel';
import { AiNote } from './AiNote';
import { aiNoteFor, hidesAiSurface, recordAiFailure, useAiAvailable, useAiDayEnd, type AiNoteState } from './availability';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[4] },
}));

export type DescriptionAssistProps = {
  vehicleId: string;
  /** The field's text now: the label stays while it is still the suggestion, and goes with the first edit. */
  value: string;
  disabled?: boolean;
  /** Puts the text into the field (not saved); the previous text comes back with the toast's "Rückgängig". */
  onSuggest: (text: string) => void;
  testID: string;
};

/**
 * GAR-03 step 3 "Beschreibung vorschlagen" (M3.7 `ai.description_assist`, flag + opt-in): a text from the vehicle's structured data
 * only (the server rejects any number not in it), put into the field as editable text and labelled "KI-Vorschlag" until edited. Used
 * up for today (429 `ai_daily_limit`, 503 `ai_budget_exhausted`): the sentence only, no action (code review phase-3-final SF-6).
 */
export function DescriptionAssist({ vehicleId, value, disabled = false, onSuggest, testID }: DescriptionAssistProps) {
  const { t } = useTranslation('garage');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const available = useAiAvailable(AI_FLAGS.description);
  const suggest = useSuggestDescription();
  const [suggested, setSuggested] = useState<{ text: string; label: string } | null>(null);
  const [note, setNote] = useState<AiNoteState | null>(null);
  const [hidden, setHidden] = useState(false);
  const dayEnd = useAiDayEnd(AI_FLAGS.description);
  if (!available || hidden) return null;
  const shownNote = dayEnd ?? note;

  const run = () => {
    setNote(null);
    const before = value;
    suggest.mutate(vehicleId, {
      onSuccess: (answer) => {
        setSuggested({ text: answer.text, label: answer.label });
        onSuggest(answer.text);
        if (before.trim()) toast(t('ai.describeReplaced'), { undo: () => onSuggest(before), testID: `${testID}.toast` });
      },
      onError: (error) => {
        recordAiFailure(AI_FLAGS.description, error);
        if (hidesAiSurface(error)) setHidden(true);
        setNote(aiNoteFor(common, error));
      },
    });
  };
  const labelled = suggested !== null && suggested.text === value;

  return (
    <View style={styles.root} testID={testID}>
      {labelled && suggested ? <AiLabel label={suggested.label} testID={`${testID}.label`} /> : null}
      {dayEnd ? null : (
        <Button
          label={t('ai.describe')}
          icon="lightbulb"
          variant="tertiary"
          size="m"
          flush="start"
          disabled={disabled || !online}
          loading={suggest.isPending}
          onPress={run}
          testID={`${testID}.action`}
        />
      )}
      {shownNote ? (
        <AiNote note={shownNote} variant="caption" testID={testID} />
      ) : (
        <Text variant="caption" color="text.secondary">
          {t('ai.describeHint')}
        </Text>
      )}
    </View>
  );
}
