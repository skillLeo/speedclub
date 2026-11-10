/**
 * "Übersetzen" (M3.7 ai.translate): per source id, the translation into the app's language once asked for, and which of the two is
 * on show. Kept in component state only: closing the screen forgets it, the server caches it (encrypted, 30 days).
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AI_FLAGS, useTranslateText, type TranslationSource } from '@/api/queries/ai';
import { toast } from '@/ui';

import { aiErrorMessage, hidesAiSurface, needsEmailVerification, recordAiFailure } from './availability';

export type TranslationState =
  | { status: 'pending' }
  | { status: 'done'; text: string; label: string; showing: 'translation' | 'original' }
  | { status: 'failed'; message: string };

export type Translations = {
  states: Readonly<Record<string, TranslationState>>;
  /** Translates the source, or switches between translation and original once there is one. */
  toggle: (id: string) => void;
  /** True once the server said the feature is off: the controls go away. */
  hidden: boolean;
};

export function targetLanguage(language: string): 'de' | 'en' {
  return language.startsWith('en') ? 'en' : 'de';
}

export function useTranslations(source: TranslationSource, testID: string): Translations {
  const { t, i18n } = useTranslation('common');
  const translate = useTranslateText();
  const [states, setStates] = useState<Record<string, TranslationState>>({});
  const [hidden, setHidden] = useState(false);
  const { mutate } = translate;
  const to = targetLanguage(i18n.language);

  const toggle = useCallback(
    (id: string) => {
      const current = states[id];
      if (current?.status === 'pending') return;
      if (current?.status === 'done') {
        setStates((all) => ({ ...all, [id]: { ...current, showing: current.showing === 'translation' ? 'original' : 'translation' } }));
        return;
      }
      setStates((all) => ({ ...all, [id]: { status: 'pending' } }));
      mutate(
        { source, id, to },
        {
          onSuccess: (result) => setStates((all) => ({ ...all, [id]: { status: 'done', text: result.text, label: result.label, showing: 'translation' } })),
          onError: (error) => {
            const message = aiErrorMessage(t, error);
            recordAiFailure(AI_FLAGS.translate, error);
            setStates((all) => ({ ...all, [id]: { status: 'failed', message } }));
            if (hidesAiSurface(error)) setHidden(true);
            // ADR-252: an unconfirmed address is the one failure the member can fix, so the toast offers the way there.
            const verify = needsEmailVerification(error) ? { label: t('ai.verifyEmail'), onPress: () => router.push('/verify-email') } : undefined;
            toast(message, { haptic: 'warning', testID: `${testID}.translateFailed`, ...(verify ? { action: verify } : {}) });
          },
        },
      );
    },
    [mutate, source, states, t, testID, to],
  );

  return { states, toggle, hidden };
}
