import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { createStyles, size } from '@/theme';
import { AppIconPicker, EmptyState, Skeleton, SkeletonBlock, Text, toast, type AppIconKey } from '@/ui';

import { useAppIcon } from '../appIcon';
import { SettingsPage } from '../components/SettingsPage';

const ROUTE = 'SET-22';

const useStyles = createStyles((t) => ({
  intro: { marginBottom: t.space[24] },
  notice: { marginTop: t.space[24] },
}));

/**
 * SET-22 /settings/appearance/icon (09 §7.9, §8.11): the AppIconPicker — Schwarz (default), Weiß, Carbon — the same logo. Native
 * only and behind `app_icons`; the web and a build without the flag get a plain "nicht verfügbar" page (a deep link must land
 * somewhere). Without the native module the picker shows the current icon and the note that it comes with an app update.
 */
export function AppIconScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const qaState = useQaState();
  const flag = useFlag('app_icons');
  const icon = useAppIcon();
  const [chosen, setChosen] = useState<AppIconKey | null>(null);
  const current = chosen ?? icon.current;
  const available = !isWeb && flag;

  const choose = (next: AppIconKey) => {
    if (!icon.supported) return;
    haptics.selection();
    setChosen(next);
    icon.set(next).catch(() => {
      setChosen(null);
      haptics.error();
      toast(t('appIcon.failed'), { testID: `${ROUTE}.failed` });
    });
  };

  return (
    <SettingsPage routeId={ROUTE} title={t('appIcon.title')} fallback="/settings/appearance" section="appearance">
      {!available ? (
        <EmptyState title={t('appIcon.unavailableTitle')} body={t('appIcon.unavailableBody')} testID={`${ROUTE}.unavailable`} />
      ) : qaState === 'loading' ? (
        <Skeleton testID={`${ROUTE}.skeleton`}>
          <SkeletonBlock height={size.thumb.card + size.row.single} corner="md" />
        </Skeleton>
      ) : (
        <View>
          <Text variant="body" color="text.secondary" style={styles.intro}>
            {t('appIcon.intro')}
          </Text>
          <AppIconPicker
            value={current}
            onChange={choose}
            disabled={!icon.supported}
            label={t('appIcon.title')}
            labels={{ black: t('appIcon.options.black'), white: t('appIcon.options.white'), carbon: t('appIcon.options.carbon') }}
            testID={`${ROUTE}.picker`}
          />
          {icon.supported ? null : (
            <Text variant="callout" color="text.secondary" style={styles.notice} role="status" testID={`${ROUTE}.notAvailable`}>
              {t('appIcon.moduleMissing')}
            </Text>
          )}
        </View>
      )}
    </SettingsPage>
  );
}
