import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useAppConfig } from '@/api/queries/appConfig';
import { useSignOut } from '@/api/queries/auth';
import { useAcceptOnboarding } from '@/api/queries/passwordless';
import { haptics } from '@/lib/haptics';
import { createStyles } from '@/theme';
import { Button } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { ConsentCheck } from '../components/ConsentCheck';
import { FormNotice } from '../components/FormNotice';
import { applyServerErrors } from '../forms';
import { finishSchema, type FinishValues } from '../schemas';

const useStyles = createStyles((t) => ({
  // As on AUTH-04: rows as tall as their label, 44 targets 4 apart.
  consents: { gap: t.space[24] },
}));

/**
 * AUTH-09b "Fast geschafft" (09 §7.2, ADR-429 e): a new account made by e-mail code, Apple or Google confirms the age and accepts
 * the AGB and the Datenschutzerklärung published now, before it can create anything. Both boxes start unticked. The versions come
 * from app-config; the session routing moves on once auth/me no longer names the step.
 */
export function FinishScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const { config, confirmed, refetch, isFetching } = useAppConfig();
  const accept = useAcceptOnboarding();
  const signOut = useSignOut();
  const [notice, setNotice] = useState<string | null>(null);
  const termsVersion = config.legal_versions.terms ?? null;
  const privacyVersion = config.legal_versions.privacy ?? null;
  const versionsKnown = Boolean(termsVersion && privacyVersion);

  // The bundled config names no versions: the screen asks for the published ones before it can send anything.
  useEffect(() => {
    if (!confirmed && !isFetching) void refetch();
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { control, handleSubmit, setError } = useForm<FinishValues>({
    resolver: zodResolver(finishSchema),
    mode: 'onSubmit',
    defaultValues: { ageConfirmed: false, termsAccepted: false },
  });

  const onSubmit = handleSubmit(
    async () => {
      if (!termsVersion || !privacyVersion) {
        setNotice(t('finish.versionsMissing'));
        return;
      }
      setNotice(null);
      try {
        await accept.mutateAsync({ termsVersion, privacyVersion });
        haptics.success();
      } catch (error) {
        if (error instanceof ApiError && (error.fieldErrors.terms_version || error.fieldErrors.privacy_version)) {
          // A new version went out while the screen was open: load it, and the member accepts that one.
          void refetch();
          setNotice(t('finish.versionsChanged'));
        } else if (error instanceof ApiError) {
          setNotice(applyServerErrors(error, setError, { age_confirmed: 'ageConfirmed' }));
        } else {
          setNotice(t('common.serverError'));
        }
      }
    },
    () => haptics.warning(),
  );

  return (
    <AuthScreen
      routeId="AUTH-09b"
      title={t('finish.title')}
      titleVariant="title2"
      subtitle={t('finish.subtitle')}
      onBack={null}
      skeletonFields={2}
      cta={{
        label: t('finish.submit'),
        onPress: () => void onSubmit(),
        loading: accept.isPending || accept.isSuccess,
        disabled: !versionsKnown && isFetching,
      }}
      footer={
        <Button
          label={t('common.signOut')}
          variant="tertiary"
          size="m"
          flush="start"
          loading={signOut.isPending}
          onPress={() => signOut.mutate()}
          testID="AUTH-09b.signOut"
        />
      }
    >
      {notice ? <FormNotice message={notice} testID="AUTH-09b.notice" /> : null}
      <View style={styles.consents}>
        <ConsentCheck routeId="AUTH-09b" control={control} name="ageConfirmed" label={t('finish.age')} />
        <ConsentCheck
          routeId="AUTH-09b"
          control={control}
          name="termsAccepted"
          label={t('finish.terms')}
          hrefs={['/settings/legal/terms', '/settings/legal/privacy']}
        />
      </View>
    </AuthScreen>
  );
}
