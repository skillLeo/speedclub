import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions } from 'react-native';

import { clearAuthIntent } from '@/state/session';
import { layout, useBreakpoint } from '@/theme';
import { EmptyState } from '@/ui';

import { SampleGarageCard } from './samples';

export type GuestPromptProps = {
  /** `<routeId>.guest`, `.signIn`. */
  routeId: string;
  /** Where the member lands after signing in. */
  returnTo: string;
};

/**
 * A guest on a page of the own profile (PROF-03/04/05): the EmptyState of 09 §5 with a real sample VehicleCard badged
 * "Beispiel", one line and "Anmelden". Never a fake profile; the brand invitation itself lives on PROF-01.
 */
export function GuestPrompt({ routeId, returnTo }: GuestPromptProps) {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { gutter } = useBreakpoint();
  const cardWidth = Math.min(width - 2 * gutter, layout.feedColumn);
  return (
    <EmptyState
      preview={<SampleGarageCard width={cardWidth} testID={`${routeId}.guest.sample`} />}
      title={t('guest.promptTitle')}
      body={t('guest.promptBody')}
      action={{
        label: t('guest.signIn'),
        onPress: () => {
          // A direct way in: nothing the guest tapped earlier belongs to it.
          clearAuthIntent();
          router.push({ pathname: '/auth/email', params: { returnTo } });
        },
      }}
      testID={`${routeId}.guest`}
    />
  );
}
