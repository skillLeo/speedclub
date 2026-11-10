import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, useSuggestPhotoCategory, type PhotoCategorySuggestion } from '@/api/queries/ai';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button } from '@/ui';

import { AiLabel } from './AiLabel';
import { AiNote } from './AiNote';
import { aiNoteFor, hidesAiSurface, recordAiFailure, useAiAvailable, useAiDayEnd, type AiNoteState } from './availability';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  root: { gap: t.space[4] },
}));

export type PhotoCategoryAssistProps = {
  mediaId: string;
  /** The category the form holds now: a suggestion equal to it needs no button. */
  current: string;
  disabled?: boolean;
  onAccept: (category: PhotoCategorySuggestion['category']) => void;
  testID: string;
};

/**
 * GAR-08 (M3.7 `ai.photo_tagging`, flag + opt-in): "Kategorie vorschlagen" asks for the photo's category only on a tap (ADR-242: no
 * personal content leaves the platform without an action by the member; code review M3.3-app SF-6), at most once per photo, and offers
 * it as "KI-Vorschlag: Innenraum" with "Kategorie übernehmen". The server reads the 640 variant only; a photo still processing (409)
 * gets a "Erneut versuchen" instead. Once the feature is used up for today (429 `ai_daily_limit`, 503 `ai_budget_exhausted`), only that
 * sentence shows, on this photo and the next (code review phase-3-final SF-6).
 */
export function PhotoCategoryAssist({ mediaId, current, disabled = false, onAccept, testID }: PhotoCategoryAssistProps) {
  const available = useAiAvailable(AI_FLAGS.photos);
  if (!available) return null;
  return <PhotoCategoryAssistBody key={mediaId} mediaId={mediaId} current={current} disabled={disabled} onAccept={onAccept} testID={testID} />;
}

function PhotoCategoryAssistBody({ mediaId, current, disabled, onAccept, testID }: PhotoCategoryAssistProps) {
  const { t } = useTranslation('garage');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const suggest = useSuggestPhotoCategory();
  const [suggestion, setSuggestion] = useState<PhotoCategorySuggestion | null>(null);
  const [note, setNote] = useState<AiNoteState | null>(null);
  const [hidden, setHidden] = useState(false);
  const dayEnd = useAiDayEnd(AI_FLAGS.photos);

  const run = () => {
    setNote(null);
    suggest.mutate(mediaId, {
      onSuccess: setSuggestion,
      onError: (error) => {
        recordAiFailure(AI_FLAGS.photos, error);
        if (hidesAiSurface(error)) setHidden(true);
        setNote(aiNoteFor(common, error));
      },
    });
  };

  if (hidden) return null;
  if (suggestion) {
    return (
      <View style={styles.row} testID={testID}>
        <AiLabel label={t('ai.photoSuggestion', { label: suggestion.label, category: suggestion.category_label })} testID={`${testID}.label`} />
        {suggestion.category === current ? null : (
          <Button
            label={t('ai.photoAccept')}
            variant="secondary"
            size="s"
            disabled={disabled}
            onPress={() => onAccept(suggestion.category)}
            testID={`${testID}.accept`}
          />
        )}
      </View>
    );
  }
  if (dayEnd) {
    return (
      <View style={styles.root} testID={testID}>
        <AiNote note={dayEnd} testID={testID} />
      </View>
    );
  }
  return (
    <View style={styles.root} testID={testID}>
      <Button
        label={note && !note.verify ? t('ai.retry') : t('ai.photoSuggest')}
        icon={note ? undefined : 'lightbulb'}
        variant="tertiary"
        size="s"
        flush="start"
        disabled={disabled || !online || note?.verify === true}
        loading={suggest.isPending}
        onPress={run}
        testID={note ? `${testID}.retry` : `${testID}.action`}
      />
      {note ? <AiNote note={note} testID={testID} /> : null}
    </View>
  );
}
