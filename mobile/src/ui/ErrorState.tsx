import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import { EmptyState } from './EmptyState';

export type ErrorStateProps = {
  /** Plain-language cause, never a raw code. Defaults to the common "Das hat nicht geklappt". */
  title?: string;
  /** What to do next. Defaults to the common hint about the connection. */
  message?: string;
  onRetry?: () => void;
  /** Replaces the common "Erneut versuchen". */
  retryLabel?: string;
  /** While the retry is running. */
  retrying?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** §8 error state: plain-language cause + retry. Same layout as the empty state, no red: it is not a destructive act. */
export function ErrorState({ title, message, onRetry, retryLabel, retrying = false, style, testID }: ErrorStateProps) {
  const { t } = useTranslation('common');
  return (
    <EmptyState
      role="alert"
      icon="warning"
      title={title ?? t('states.errorTitle')}
      body={message ?? t('states.errorBody')}
      action={
        onRetry
          ? { label: retryLabel ?? t('actions.retry'), onPress: onRetry, variant: 'secondary', size: 'm', loading: retrying }
          : undefined
      }
      style={style}
      testID={testID}
    />
  );
}
