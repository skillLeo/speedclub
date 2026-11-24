import { useLocalSearchParams } from 'expo-router';

import { IntroScreen } from '@/features/intro/IntroScreen';

/** INTRO-01…04 (R4-1.4): `?replay=1` from Settings › Hilfe shows the pages again without touching the account's mark. */
export default function Route() {
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  return <IntroScreen replay={replay === '1'} />;
}
