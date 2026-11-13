import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { isReauthCancelled } from '@/api/queries/recentAuth';
import { useAddPasskey } from '@/api/queries/security';
import { hapticFor } from '@/lib/haptics';
import { createStyles, ThemeScope } from '@/theme';
import { ProviderStackPreview, providerOrder, toast } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { FormNotice } from '../components/FormNotice';
import { answerPasskeyOffer } from '../passkeyOffer';
import { createPasskey, isPasskeyCancelled } from '../providers/passkeys';
import { useProviderAvailability } from '../providers/useProviderSignIn';

const useStyles = createStyles((t) => ({
  // DQ-994: the AUTH-02 stack as it looks on the welcome photo's dark stage, a picture of the way in, not a control (09 §7.2).
  fragment: {
    backgroundColor: t.color.media.ground,
    borderRadius: t.radius.md,
    padding: t.space[16],
    pointerEvents: 'none',
  },
}));

/** AUTH-02 is dark in every theme, so its picture is too. */
const BRAND_THEME = 'carbon' as const;

/**
 * AUTH-14 "Schneller rein mit Passkey" (09 §7.2): once per device, after a sign-in on a device that can hold a passkey. The stack
 * of AUTH-02 shows where the passkey will be offered; "Passkey hinzufügen" runs the platform prompt (the sign-in just now counts as
 * recent authentication), "Später" goes on. Either answer ends the offer on this device.
 */
export function PasskeyOfferScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const add = useAddPasskey();
  const available = useProviderAvailability();
  const [notice, setNotice] = useState<string | null>(null);
  const stack = providerOrder({ ...available, passkey: true });

  const addPasskey = async () => {
    setNotice(null);
    try {
      await add.mutateAsync({ create: (options) => createPasskey(options.options) });
      hapticFor('passkeyAdded');
      toast(t('passkeyOffer.added'), { testID: 'AUTH-14.toast' });
      answerPasskeyOffer();
    } catch (error) {
      if (isPasskeyCancelled(error) || isReauthCancelled(error)) return;
      setNotice(error instanceof ApiError ? error.message : t('passkeyOffer.failed'));
    }
  };

  return (
    <AuthScreen
      routeId="AUTH-14"
      title={t('passkeyOffer.title')}
      titleVariant="title2"
      // DQ-1007: the body heads under its title at 8, as on every other auth screen.
      subtitle={t('passkeyOffer.body')}
      skeletonFields={0}
      onBack={null}
      cta={{ label: t('passkeyOffer.add'), onPress: () => void addPasskey(), loading: add.isPending }}
      secondary={{ label: t('passkeyOffer.later'), onPress: answerPasskeyOffer, disabled: add.isPending, testID: 'AUTH-14.later' }}
      lead={
        <ThemeScope name={BRAND_THEME}>
          <View aria-hidden style={styles.fragment} testID="AUTH-14.fragment">
            <ProviderStackPreview
              providers={stack}
              marked="passkey"
              labels={{
                apple: t('providers.continue.apple'),
                google: t('providers.continue.google'),
                email: t('providers.continue.email'),
                passkey: t('providers.continue.passkey'),
              }}
              testID="AUTH-14.stack"
            />
          </View>
        </ThemeScope>
      }
    >
      {notice ? <FormNotice message={notice} testID="AUTH-14.notice" /> : null}
    </AuthScreen>
  );
}
