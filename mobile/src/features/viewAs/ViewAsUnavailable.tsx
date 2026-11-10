import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import { EmptyState } from '@/ui';

export type ViewAsUnavailableProps = {
  /** What is held back: the messages (MSG-01 and everything under it) or the data export (SET-12). */
  kind: 'messages' | 'export';
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * "In der Ansicht als Mitglied nicht verfügbar" (m3.2-contract §3, ADR-227): view-as never shows messages, their counts or the export
 * that carries them. The server refuses them with 403 `view_as_no_messages`; this is the designed state in their place, not an error.
 */
export function ViewAsUnavailable({ kind, style, testID }: ViewAsUnavailableProps) {
  const { t } = useTranslation('auth');
  return (
    <EmptyState
      icon="lock-simple"
      title={t('viewAs.unavailableTitle')}
      body={t(kind === 'messages' ? 'viewAs.messagesBody' : 'viewAs.exportBody')}
      style={style}
      testID={testID}
    />
  );
}
