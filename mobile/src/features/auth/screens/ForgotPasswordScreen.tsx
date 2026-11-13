import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { useForgotPassword } from '@/api/queries/auth';
import { slot } from '@/ui/SlotText';
import { identifierText } from '@/ui/textBreaks';

import { AuthScreen } from '../components/AuthScreen';
import { EMAIL_INPUT, FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { handEmailTo, useHandedEmail } from '../emailHandoff';
import { applyServerErrors } from '../forms';
import { forgotPasswordSchema, type ForgotPasswordValues } from '../schemas';

/** AUTH-06. The confirmation reads the same whether the address has an account or not. */
export function ForgotPasswordScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const handedEmail = useHandedEmail('/forgot-password', params.email);
  const forgot = useForgotPassword();
  const [notice, setNotice] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ email: string; resend: number | null } | null>(null);

  const { control, handleSubmit, setError, formState } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: handedEmail ?? '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setNotice(null);
    try {
      const next = await forgot.mutateAsync(email);
      setSentTo({ email: next.email, resend: next.resend_after_seconds });
    } catch (error) {
      setNotice(error instanceof ApiError ? applyServerErrors(error, setError, { email: 'email' }) : t('common.serverError'));
    }
  });

  if (sentTo) {
    return (
      <AuthScreen
        routeId="AUTH-06"
        skeletonFields={0}
        title={t('forgot.sentTitle')}
        subtitle={t('forgot.sentBody', { email: slot('email') })}
        subtitleSlots={{ email: identifierText(sentTo.email) }}
        cta={{
          label: t('forgot.enterCode'),
          onPress: () => {
            handEmailTo('/reset-password', sentTo.email);
            router.push({ pathname: '/reset-password', params: { resend: String(sentTo.resend ?? 0) } });
          },
        }}
      >
        <FormNotice tone="info" message={t('forgot.spamHint')} testID="AUTH-06.sent" />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      routeId="AUTH-06"
      title={t('forgot.title')}
      subtitle={t('forgot.subtitle')}
      skeletonFields={1}
      dirty={formState.isDirty && !forgot.isPending}
      cta={{ label: t('forgot.submit'), onPress: () => void onSubmit(), loading: forgot.isPending }}
    >
      {notice ? <FormNotice message={notice} testID="AUTH-06.notice" /> : null}
      <FormField
        control={control}
        name="email"
        label={t('fields.email')}
        {...EMAIL_INPUT}
        returnKeyType="go"
        onSubmitEditing={() => void onSubmit()}
        testID="AUTH-06.email"
      />
    </AuthScreen>
  );
}
