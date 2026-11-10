import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, useInterpretSearch, type InterpretationChip } from '@/api/queries/ai';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button } from '@/ui';

import { AiNote } from './AiNote';
import { aiNoteFor, hidesAiSurface, recordAiFailure, useAiAvailable, useAiDayEnd, type AiNoteState } from './availability';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[4] },
}));

export type AiSearchActionProps = {
  /** The text in the search field. */
  text: string;
  /** The chips to apply as normal, editable filter chips, with the server's "KI-Vorschlag" label. */
  onApply: (chips: readonly InterpretationChip[], label: string) => void;
  testID: string;
};

/**
 * DISC-02 "Mit KI suchen" (M3.7 `ai.nl_search`, flag + opt-in): reads the typed search ("schwarze M4 mit KW V3 und 19 Zoll") as filter
 * chips, which the screen applies like any others. Nothing when the feature is off; a short line under it when it found nothing or
 * failed. Used up for today (429 `ai_daily_limit`, 503 `ai_budget_exhausted`): that line only, no action (code review phase-3-final
 * SF-6).
 */
export function AiSearchAction({ text, onApply, testID }: AiSearchActionProps) {
  const { t } = useTranslation('discover');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const available = useAiAvailable(AI_FLAGS.search);
  const interpret = useInterpretSearch();
  const [note, setNote] = useState<AiNoteState | null>(null);
  const [hidden, setHidden] = useState(false);
  const dayEnd = useAiDayEnd(AI_FLAGS.search);
  if (!available || hidden) return null;
  const shownNote = dayEnd ?? note;
  const query = text.trim();

  const run = () => {
    setNote(null);
    interpret.mutate(query, {
      onSuccess: (answer) => {
        if (answer.chips.length === 0) setNote({ text: t('ai.nothing'), verify: false });
        else onApply(answer.chips, answer.label);
      },
      onError: (error) => {
        recordAiFailure(AI_FLAGS.search, error);
        if (hidesAiSurface(error)) setHidden(true);
        setNote(aiNoteFor(common, error));
      },
    });
  };

  return (
    <View style={styles.root} testID={testID}>
      {dayEnd ? null : (
        <Button
          label={t('ai.action')}
          icon="lightbulb"
          variant="tertiary"
          size="s"
          flush="start"
          disabled={query === '' || !online}
          loading={interpret.isPending}
          onPress={run}
          testID={`${testID}.action`}
        />
      )}
      {shownNote ? <AiNote note={shownNote} testID={testID} /> : null}
    </View>
  );
}
