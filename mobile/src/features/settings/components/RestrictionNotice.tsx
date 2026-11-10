import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useMe } from '@/api/queries/auth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Button } from '@/ui';

const useStyles = createStyles((t) => ({
  block: { gap: t.space[4] },
}));

export type RestrictionNoticeProps = {
  routeId: string;
  /** `support` (SET-15): the notice says support stays reachable, the restriction's own questions included. */
  scope?: 'settings' | 'support';
  style?: StyleProp<ViewStyle>;
};

/**
 * The restricted state of the settings (03 §8 state contract). A restriction limits publishing and messaging, never the member's own
 * data: settings, export and deletion keep working (08_LEGAL_COMPLIANCE §1), and the notice says exactly that. "Begründung ansehen"
 * opens the decision behind it (SAFE-01) when the account names one.
 */
export function RestrictionNotice({ routeId, scope = 'settings', style }: RestrictionNoticeProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const me = useMe();
  const restrictions = me.data?.restrictions;
  const until = restrictions?.publishing.until ?? restrictions?.messaging.until ?? null;
  const restricted =
    qaState === 'restricted' || Boolean(restrictions && (restrictions.publishing.restricted || restrictions.messaging.restricted));
  if (!restricted) return null;
  const decisionId =
    (restrictions?.publishing.restricted ? restrictions.publishing.decision_id : null) ??
    (restrictions?.messaging.restricted ? restrictions.messaging.decision_id : null) ??
    null;
  const message =
    scope === 'support'
      ? t('restricted.supportBody')
      : until
        ? t('restricted.until', { date: format.dateTime(new Date(until)) })
        : t('restricted.body');
  return (
    <View style={[styles.block, style]}>
      <FormNotice tone="info" message={message} testID={`${routeId}.restricted`} />
      {decisionId ? (
        <Button
          label={t('restricted.reasons')}
          variant="tertiary"
          size="m"
          role="link"
          flush="start"
          onPress={() => router.push({ pathname: '/decision/[id]', params: { id: decisionId } })}
          testID={`${routeId}.restricted.reasons`}
        />
      ) : null}
    </View>
  );
}
