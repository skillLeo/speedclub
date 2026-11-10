/**
 * States shared by the browse screens Start (HOME-01), Entdecken (DISC-01) and Suche (DISC-02). Reading is never limited:
 * a publishing or messaging restriction, or a suspension, only adds a calm notice (§3.1).
 */
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { ApiError } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';
import { ErrorState } from '@/ui';

/** The two lines of a restriction notice, as keys of `home`: what still works differs per screen (DQ-300). */
export type RestrictionCopy = { body: string; until: string };

const BROWSE_COPY: RestrictionCopy = { body: 'restricted.body', until: 'restricted.until' };

/** What the notice says, or null for a member without a restriction and for guests. */
export function useBrowseRestriction(copy: RestrictionCopy = BROWSE_COPY): string | null {
  const { t } = useTranslation('home');
  const format = useFormat();
  const qaState = useQaState();
  const member = useSessionStore((state) => state.status === 'member');
  const me = useMe();
  if (qaState === 'restricted') return t(copy.body);
  if (!member) return null;
  const restrictions = me.data?.restrictions;
  if (!restrictions) return null;
  if (restrictions.suspended) return t('restricted.suspended');
  const limit = restrictions.publishing.restricted
    ? restrictions.publishing
    : restrictions.messaging.restricted
      ? restrictions.messaging
      : null;
  if (!limit) return null;
  return limit.until ? t(copy.until, { date: format.dateTime(new Date(limit.until)) }) : t(copy.body);
}

export function RestrictionNotice({ message, testID, style }: { message: string; testID: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <FormNotice message={message} tone="info" testID={testID} />
    </View>
  );
}

/** The server's own sentence for a rate limit; anything else gets the screen's plain-language line. */
export function errorMessageOf(error: unknown): string | undefined {
  return error instanceof ApiError && error.kind === 'rate_limited' ? error.message : undefined;
}

/**
 * Offline without a copy on the device, or an error, with the retry. A rate limit says how long to wait, in the server's
 * own words ("Zu viele Suchanfragen. Versuch es in 30 Sekunden noch einmal.").
 */
export function BrowseErrorState({
  routeId,
  title,
  offline,
  error,
  onRetry,
  retrying,
}: {
  routeId: string;
  /** What could not be loaded, in the screen's words; Start's line by default. */
  title?: string;
  offline: boolean;
  error?: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useTranslation('home');
  return (
    <ErrorState
      title={offline ? t('error.offlineTitle') : (title ?? t('error.title'))}
      message={offline ? t('error.offlineBody') : (errorMessageOf(error) ?? t('error.body'))}
      onRetry={onRetry}
      retrying={retrying}
      testID={`${routeId}.${offline ? 'offline' : 'error'}`}
    />
  );
}
