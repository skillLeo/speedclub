import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { Hairline, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';

import { SettingsPage } from '../components/SettingsPage';
import { appVersionInfo } from '../version';
import { RELEASE_NOTES } from '../whatsNew';

const ROUTE = 'SET-25';

const useStyles = createStyles((t) => ({
  intro: { marginBottom: t.space[24] },
  skeleton: { gap: t.space[12] },
  list: { gap: t.space[32] },
  release: { gap: t.space[16] },
  head: { gap: t.space[2] },
  item: { gap: t.space[2] },
}));

/**
 * SET-25 /settings/about/whats-new (09 §7.9): the release notes newest first. Each release: "Version 2.0.0" (headline) with its month,
 * then each change as a short title (callout.strong) and one sentence (body), sentences wrapping at their spaces like any text. (The
 * build Timeline was tried first: its diff lines break anywhere, which split "Bewegun/gen" in the m4.10-shots audit.)
 */
export function WhatsNewScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const format = useFormat();
  const qaState = useQaState();
  const { version, build } = appVersionInfo();
  return (
    <SettingsPage routeId={ROUTE} title={t('whatsNew.title')} fallback="/settings" section="whatsNew">
      <Text variant="body" color="text.secondary" style={styles.intro} testID={`${ROUTE}.installed`}>
        {t('whatsNew.installed', { version, build })}
      </Text>
      {qaState === 'loading' ? (
        <Skeleton testID={`${ROUTE}.skeleton`}>
          <View style={styles.skeleton}>
            <SkeletonText variant="headline" width="45%" />
            <SkeletonText variant="callout" width="30%" />
            <SkeletonBlock height={size.row.withThumb * 3} corner="md" />
          </View>
        </Skeleton>
      ) : (
        <View style={styles.list} role="list" testID={`${ROUTE}.timeline`}>
          {RELEASE_NOTES.map((note, index) => (
            <View key={note.version} role="listitem" style={styles.release} testID={`${ROUTE}.release.${note.version}`}>
              {index > 0 ? <Hairline /> : null}
              <View style={styles.head}>
                <Text variant="headline" role="heading" {...({ 'aria-level': 2 } as object)}>
                  {t('whatsNew.version', { version: note.version })}
                </Text>
                <Text variant="callout" color="text.secondary">
                  {format.monthYear(new Date(note.date))}
                </Text>
              </View>
              {note.items.map((item) => (
                <View key={item} style={styles.item} testID={`${ROUTE}.release.${note.version}.${item}`}>
                  <Text variant="calloutStrong">{t(`whatsNew.items.${item}`)}</Text>
                  <Text variant="body" color="text.secondary">
                    {t(`whatsNew.items.${item}Body`)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </SettingsPage>
  );
}
