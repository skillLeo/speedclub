import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConfirmLink } from '@/api/queries/passwordless';
import { toast } from '@/ui';
import { slot } from '@/ui/SlotText';
import { identifierText } from '@/ui/textBreaks';

import { AuthScreen } from '../components/AuthScreen';
import { CodeInput, CodeInputSkeleton } from '../components/CodeInput';
import { FormNotice } from '../components/FormNotice';
import { forgetLinkStep, heldLinkStep } from '../linkStep';
import { useAnswerRouting } from '../providers/useProviderSignIn';
import { useCodeStep } from './CodeEntryScreen';

/**
 * AUTH-16 (09 §7.2, §8.1): an Apple or Google sign-in whose address belongs to an account that exists already. Never linked
 * automatically: the code went to that address, and only the code links (with two-factor on, AUTH-11 follows, SEC-M46-02).
 */
export function LinkAccountScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const [link] = useState(() => heldLinkStep());
  const confirm = useConfirmLink();
  const route = useAnswerRouting();
  const provider = link ? t(`providers.name.${link.provider}`) : '';

  const step = useCodeStep({
    initialWait: 0,
    verify: async (code) => {
      if (!link) return;
      const answer = await confirm.mutateAsync({ attemptId: link.attempt_id, code });
      forgetLinkStep();
      if (answer.kind === 'session') toast(t('link.linked', { provider }), { haptic: 'success', testID: 'AUTH-16.toast' });
      route(answer);
    },
    // A new code means a new provider sign-in (the attempt belongs to it): the way back is AUTH-02.
    resend: () => Promise.resolve(0),
  });

  useEffect(() => {
    if (!link) router.replace('/welcome');
  }, [link, router]);

  if (!link) {
    return <AuthScreen routeId="AUTH-16" title={t('link.title')} titleVariant="title2" skeleton={<CodeInputSkeleton />} skeletonFields={0} />;
  }

  return (
    <AuthScreen
      routeId="AUTH-16"
      title={t('link.title')}
      titleVariant="title2"
      subtitle={t('link.body', { email: slot('email'), provider })}
      subtitleSlots={{ email: identifierText(link.email_hint) }}
      skeleton={<CodeInputSkeleton />}
      skeletonFields={0}
    >
      {step.notice ? <FormNotice message={step.notice} tone={step.locked ? 'info' : 'error'} numeric={step.locked} testID="AUTH-16.notice" /> : null}
      <CodeInput
        value={step.code}
        onChange={step.setCode}
        onComplete={(code) => void step.submit(code)}
        label={t('code.label')}
        error={step.error}
        errorKey={step.errorKey}
        success={confirm.isSuccess}
        disabled={step.busy}
        inert={step.locked}
        autoFocus
        testID="AUTH-16.code"
      />
    </AuthScreen>
  );
}
