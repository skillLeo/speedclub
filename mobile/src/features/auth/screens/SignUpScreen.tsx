import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, type TextInput as RNTextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { useRegister } from '@/api/queries/auth';
import { createStyles } from '@/theme';
import { Button } from '@/ui';

import { AuthScreen, FooterLink } from '../components/AuthScreen';
import { ConsentCheck } from '../components/ConsentCheck';
import { EMAIL_INPUT, FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { RuleList } from '../components/RuleList';
import { handEmailTo, useHandedEmail } from '../emailHandoff';
import { applyServerErrors, onlyEmailDirty, useLeaveForm, useReturnToParam } from '../forms';
import { holdRegistrationPassword } from '../pendingRegistration';
import { forgetSignupOrigin, signupRef } from '../signupRef';
import { passwordChecks, signUpSchema, type SignUpValues } from '../schemas';

const useStyles = createStyles((t) => ({
  field: { gap: t.space[8] },
  // A row is as tall as its label, and its 44 target reaches into the space around it (see ConsentCheck). 24 between rows keeps
  // the 48 pitch of 44 rows 4 apart, and the targets of neighbouring rows apart.
  consents: { gap: t.space[24] },
}));

/** AUTH-04. The answer never says whether an address is known: a known one gets a mail instead of a code. */
export function SignUpScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; returnTo?: string; next?: string }>();
  useReturnToParam(params);
  const handedEmail = useHandedEmail('/sign-up', params.email);
  const passwordRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  const register = useRegister();
  const [notice, setNotice] = useState<string | null>(null);
  const { leaving, leave } = useLeaveForm();

  const { control, handleSubmit, setError, getValues, formState } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: 'onTouched',
    defaultValues: {
      email: handedEmail ?? '',
      password: '',
      ageConfirmed: false,
      termsAccepted: false,
      privacyAccepted: false,
      marketingConsent: false,
    },
  });
  // Read during render: React Hook Form only tracks the parts of formState that render reads.
  const { isDirty, dirtyFields } = formState;
  const password = useWatch({ control, name: 'password' });
  const email = useWatch({ control, name: 'email' });
  const checks = passwordChecks(password, email);

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null);
    try {
      const next = await register.mutateAsync({
        email: values.email,
        password: values.password,
        marketingConsent: values.marketingConsent,
        ref: signupRef(),
      });
      forgetSignupOrigin();
      holdRegistrationPassword(next.email, values.password);
      handEmailTo('/verify-email', next.email);
      router.push({ pathname: '/verify-email', params: { resend: String(next.resend_after_seconds ?? 0) } });
    } catch (error) {
      if (error instanceof ApiError) {
        setNotice(
          applyServerErrors(error, setError, {
            email: 'email',
            password: 'password',
            accepted_age_16: 'ageConfirmed',
            accepted_terms: 'termsAccepted',
            accepted_privacy: 'privacyAccepted',
            marketing_consent: 'marketingConsent',
          }),
        );
      } else {
        setNotice(t('common.serverError'));
      }
    }
  });

  const toSignIn = () => {
    handEmailTo('/sign-in', getValues('email'));
    const target = '/sign-in';
    if (onlyEmailDirty(dirtyFields)) leave(target);
    else router.replace(target);
  };

  return (
    <AuthScreen
      routeId="AUTH-04"
      title={t('signUp.title')}
      subtitle={t('signUp.subtitle')}
      skeletonFields={2}
      dirty={isDirty && !leaving && !register.isPending && !register.isSuccess}
      cta={{ label: t('signUp.submit'), onPress: () => void onSubmit(), loading: register.isPending }}
      footer={
        <FooterLink text={t('signUp.hasAccount')}>
          <Button
            label={t('signUp.toSignIn')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={toSignIn}
            testID="AUTH-04.toSignIn"
          />
        </FooterLink>
      }
    >
      {notice ? <FormNotice message={notice} testID="AUTH-04.notice" /> : null}
      <FormField
        control={control}
        name="email"
        label={t('fields.email')}
        {...EMAIL_INPUT}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
        testID="AUTH-04.email"
      />
      <View style={styles.field}>
        <FormField
          control={control}
          name="password"
          label={t('fields.password')}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          testID="AUTH-04.password"
          inputRef={passwordRef}
        />
        <RuleList
          testID="AUTH-04.rules"
          rules={[
            { key: 'length', label: t('rules.length'), met: checks.length },
            { key: 'notEmail', label: t('rules.notEmail'), met: checks.notEmail },
            { key: 'common', label: t('rules.common'), met: null },
          ]}
        />
      </View>
      <View style={styles.consents}>
        <ConsentCheck routeId="AUTH-04" control={control} name="ageConfirmed" label={t('signUp.age')} />
        <ConsentCheck routeId="AUTH-04" control={control} name="termsAccepted" label={t('signUp.terms')} hrefs={['/settings/legal/terms']} />
        <ConsentCheck routeId="AUTH-04" control={control} name="privacyAccepted" label={t('signUp.privacy')} hrefs={['/settings/legal/privacy']} />
        <ConsentCheck routeId="AUTH-04" control={control} name="marketingConsent" label={t('signUp.marketing')} />
      </View>
    </AuthScreen>
  );
}

/** Kept here for the layout tests of AUTH-04 (DQ-142, DQ-148). */
export { plainSentence, splitClosingPunctuation, splitDocLink } from '../components/ConsentCheck';
