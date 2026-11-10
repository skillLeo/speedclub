import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';

import { apiOrigin } from '@/api/client';
import { useAppConfig } from '@/api/queries/appConfig';
import { toast } from '@/ui';

import { currentAppVersion } from '../AppConfigGate';
import { storeLinkFor } from '../storeLink';
import { GateScreen } from './GateScreen';

/**
 * SYS-01 (DQ-081): the minimum version of app-config is above this build. The button leads to this platform's store listing,
 * or to WEB-04 `/app-laden` while the listing does not exist yet (staging builds for testers, pre-launch).
 */
export function UpdateRequiredScreen() {
  const { t } = useTranslation('common');
  const { config } = useAppConfig();
  const [opening, setOpening] = useState(false);
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  const link = storeLinkFor(Platform.OS, config.links, apiOrigin());
  const required = platform ? config.min_version[platform] : null;

  const open = async () => {
    if (!link) return;
    setOpening(true);
    try {
      await Linking.openURL(link.url);
    } catch {
      toast(t('system.update.openFailed'), { testID: 'SYS-01.toast' });
    } finally {
      setOpening(false);
    }
  };

  return (
    <GateScreen
      routeId="SYS-01"
      title={t('gate.updateTitle')}
      // M3.5 ADM-37: the published force-update text in the request's language, else the bundled one.
      body={config.force_update_message?.trim() || t('gate.updateBody')}
      hyphenateBody={false}
      detail={required ? t('system.update.version', { current: currentAppVersion, required }) : undefined}
      primary={link ? { label: t(`system.update.${link.kind}`), onPress: () => void open(), loading: opening } : undefined}
    />
  );
}
