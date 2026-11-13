import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { isNative } from '@/lib/platform';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Icon, Screen, Text, type IconName } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { primerAnswered, primerShown } from '../primer';
import { askPushPermission, readPushPermission, registerPushToken } from '../push';

const ROUTE = 'AUTH-10';

const useStyles = createStyles((t) => ({
  points: { gap: t.space[16] },
  point: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  // The glyph sits on the first line of its title (body.strong line 22: 1 above a 20 glyph; 2 is the nearest space token).
  glyph: { paddingTop: t.space[2] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
}));

type Point = { key: 'messages' | 'followers' | 'quiet'; icon: IconName };

/** What a push is for, in the defaults of the §7 matrix: never more than the member will get. */
const POINTS: readonly Point[] = [
  { key: 'messages', icon: 'chats' },
  { key: 'followers', icon: 'user' },
  { key: 'quiet', icon: 'bell-slash' },
];

/**
 * AUTH-10 `/notifications-primer`, native only (04 §3, 08 §6): says what a push is for before the OS asks. "Mitteilungen erlauben"
 * opens the OS prompt; "Später" leaves it for SET-09. Either way F1 goes on to the garage (SessionHost). A permission the OS has
 * already decided is not asked about again: the step passes by itself. The web has no push, and its route moves on.
 */
export function NotificationsPrimerScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const memberId = useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? null) : null));
  const [asking, setAsking] = useState(false);
  const answered = useRef(false);

  useEffect(() => {
    if (!isNative || memberId === null) return undefined;
    let current = true;
    void (async () => {
      const permission = await readPushPermission();
      if (!current) return;
      if (permission === 'undetermined') {
        await primerShown(memberId);
        return;
      }
      // Decided already: allowed sends the token, and either way there is nothing to explain.
      answered.current = true;
      if (permission === 'granted') void registerPushToken();
      await primerAnswered();
    })();
    return () => {
      current = false;
    };
  }, [memberId]);

  const allow = async () => {
    if (answered.current) return;
    answered.current = true;
    setAsking(true);
    const permission = await askPushPermission();
    if (permission === 'granted') void registerPushToken();
    await primerAnswered();
  };

  const later = async () => {
    if (answered.current) return;
    answered.current = true;
    await primerAnswered();
  };

  // The web goes on at once (SessionHost); the screen only opens the first-screen gate meanwhile.
  if (!isNative) return <Screen testID={`${ROUTE}.root`} />;

  return (
    <AuthScreen
      routeId={ROUTE}
      title={t('primer.title')}
      subtitle={t('primer.subtitle')}
      onBack={null}
      skeletonFields={0}
      cta={{ label: t('primer.allow'), onPress: () => void allow(), loading: asking }}
      secondary={{ label: t('primer.later'), onPress: () => void later(), disabled: asking, testID: `${ROUTE}.later` }}
    >
      <View style={styles.points} testID={`${ROUTE}.points`}>
        {POINTS.map((point) => (
          <View key={point.key} style={styles.point} testID={`${ROUTE}.point.${point.key}`}>
            <View style={styles.glyph}>
              <Icon name={point.icon} size={20} color="text.secondary" />
            </View>
            <View style={styles.text}>
              <Text variant="bodyStrong">{t(`primer.points.${point.key}.title`)}</Text>
              <Text variant="callout" color="text.secondary">
                {t(`primer.points.${point.key}.body`)}
              </Text>
            </View>
          </View>
        ))}
        <Text variant="caption" color="text.tertiary" testID={`${ROUTE}.settingsHint`}>
          {t('primer.settingsHint')}
        </Text>
      </View>
    </AuthScreen>
  );
}
