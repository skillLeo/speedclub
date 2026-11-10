import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/queries/auth';
import { Button } from '@/ui';

/**
 * The decision behind a restriction in force (`MeResource.restrictions.<kind>.decision_id`, a suspension's while suspended), so a
 * restricted screen can link to its statement of reasons. Null without one.
 */
export function useRestrictionDecision(kind: 'messaging' | 'publishing'): string | null {
  const restrictions = useMe().data?.restrictions;
  return restrictions?.[kind].decision_id ?? null;
}

/** "Begründung ansehen" → SAFE-01. */
export function DecisionLink({ decisionId, testID }: { decisionId: string; testID: string }) {
  const { t } = useTranslation('safety');
  const router = useRouter();
  return (
    <Button
      label={t('decision.viewReasons')}
      variant="tertiary"
      size="m"
      role="link"
      flush="start"
      onPress={() => router.push({ pathname: '/decision/[id]', params: { id: decisionId } })}
      testID={testID}
    />
  );
}
