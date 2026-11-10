import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, type TranslationSource } from '@/api/queries/ai';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button, Text, type TextProps } from '@/ui';

import { AiLabel } from './AiLabel';
import { useAiAvailable, useAiDayEnd } from './availability';
import { useTranslations, type Translations, type TranslationState } from './translations';

const useStyles = createStyles((t) => ({
  controls: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space[4] },
}));

export type TranslationControlsProps = {
  state: TranslationState | undefined;
  onToggle: () => void;
  testID: string;
};

/**
 * "Übersetzen" under a text, then "Übersetzt · Original anzeigen" (EU AI Act Art. 50: the label says what the member reads). One
 * row of tertiary S actions, neutral and flush with the text above (DQ-673); the server's label with the translate glyph. Used up for today (429 `ai_daily_limit`, 503
 * `ai_budget_exhausted`, said by the toast): no "Übersetzen" or "Erneut übersetzen" any more, while a translation on show keeps its
 * switch (code review phase-3-final SF-6).
 */
export function TranslationControls({ state, onToggle, testID }: TranslationControlsProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const online = useOnline();
  const dayEnd = useAiDayEnd(AI_FLAGS.translate);
  if (state?.status === 'done') {
    return (
      <View style={styles.controls} testID={testID}>
        {state.showing === 'translation' ? <AiLabel label={state.label} kind="translation" testID={`${testID}.label`} /> : null}
        <Button
          label={state.showing === 'translation' ? t('ai.translate.showOriginal') : t('ai.translate.showTranslation')}
          variant="tertiary"
          size="s"
          flush="start"
          onPress={onToggle}
          testID={`${testID}.toggle`}
        />
      </View>
    );
  }
  if (dayEnd) return null;
  return (
    <View style={styles.controls} testID={testID}>
      <Button
        label={state?.status === 'failed' ? t('ai.translate.retry') : t('ai.translate.action')}
        icon="translate"
        variant="tertiary"
        size="s"
        flush="start"
        loading={state?.status === 'pending'}
        disabled={!online}
        onPress={onToggle}
        accessibilityLabel={state?.status === 'pending' ? t('ai.translate.pending') : undefined}
        testID={`${testID}.action`}
      />
    </View>
  );
}

/** The text a translation state shows: the translation while it is on show, else the original. */
export function shownText(original: string, state: TranslationState | undefined): string {
  return state?.status === 'done' && state.showing === 'translation' ? state.text : original;
}

export type TranslatableTextProps = {
  source: TranslationSource;
  /** The vehicle, build update or message id the server translates. */
  id: string;
  text: string;
  variant?: TextProps['variant'];
  /** Renders the text in its own way (VEH-01's clamp with "Mehr"); gets the text to show. */
  render?: (text: string) => ReactNode;
  testID: string;
  /** Shared state when several texts of a screen translate (MSG-02); otherwise its own. */
  translations?: Translations;
};

/**
 * A text of another member with "Übersetzen" under it (M3.7, `ai.translate`): only while the flag is on and a member is signed in.
 * Without the flag it is the plain text, exactly as before.
 */
export function TranslatableText({ source, id, text, variant = 'body', render, testID, translations }: TranslatableTextProps) {
  const available = useAiAvailable(AI_FLAGS.translate);
  if (!available) return render ? <>{render(text)}</> : <Text variant={variant} testID={testID}>{text}</Text>;
  return <Translatable source={source} id={id} text={text} variant={variant} render={render} testID={testID} translations={translations} />;
}

function Translatable({ source, id, text, variant, render, testID, translations }: TranslatableTextProps) {
  const own = useTranslations(source, testID);
  const shared = translations ?? own;
  const state = shared.states[id];
  const shown = shownText(text, state);
  return (
    <View>
      {render ? render(shown) : <Text variant={variant} testID={testID}>{shown}</Text>}
      {shared.hidden ? null : <TranslationControls state={state} onToggle={() => shared.toggle(id)} testID={`${testID}.translate`} />}
    </View>
  );
}
