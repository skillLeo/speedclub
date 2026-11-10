import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useUpdateMemberSettings } from '@/api/queries/settings';
import { setStored } from '@/lib/storage';
import { useQaState } from '@/lib/qa';
import type { PowerDisplay } from '@/lib/units';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';

import { RowGroup } from '@/ui/RowGroup';
import { RadioRows } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { useFailureMessage } from '../forms';
import { POWER_DISPLAYS, setPowerDisplay, usePowerDisplay } from '../powerDisplay';

const ROUTE = 'SET-11';
/** §3.9: the example every display is shown with. */
export const EXAMPLE_PS = 510;

type Language = 'de' | 'en';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  example: { gap: t.space[2], paddingHorizontal: ROW_INSET, paddingVertical: t.space[12] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
}));

/**
 * SET-11 /settings/language: Deutsch or English, and the power display with a live example ("510 PS (375 kW)"). Both apply at
 * once. The language syncs to the account through the settings sync (§11); the power display is saved to the account directly
 * and kept on the device. Metric only (§3.9).
 */
export function LanguageScreen() {
  const { t, i18n } = useTranslation('settings');
  const styles = useStyles();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const member = useSessionStore((state) => state.status === 'member');
  const status = useSessionStore((state) => state.status);
  const failure = useFailureMessage();
  const update = useUpdateMemberSettings();
  const display = usePowerDisplay();
  const language: Language = i18n.language === 'en' ? 'en' : 'de';

  const chooseLanguage = (next: Language) => {
    if (next === language) return;
    void setStored('sc.locale', next);
    void i18n.changeLanguage(next);
  };
  /** Applies at once on every screen; a member's account follows, and a refusal puts the previous display back. */
  const choosePower = (next: PowerDisplay) => {
    if (next === display) return;
    const previous = display;
    setPowerDisplay(next);
    if (!member) return;
    update.mutate(
      { power_display: next },
      {
        onError: (error) => {
          setPowerDisplay(previous);
          toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });
        },
      },
    );
  };

  const loading = qaState === 'loading' || status === 'loading';

  return (
    <SettingsPage routeId={ROUTE} title={t('language.title')} fallback="/settings" offlineLabel={t('language.offlineBanner')} section="language">
      {loading ? (
        <Skeleton testID={`${ROUTE}.skeleton`}>
          <View style={styles.groups}>
            {[2, 3].map((rows) => (
              <View key={rows} style={styles.skeletonGroup}>
                <SkeletonText variant="labelS" width="30%" style={styles.skeletonLabel} />
                <SkeletonBlock height={size.row.single * rows + size.row.withThumb} corner="md" />
              </View>
            ))}
          </View>
        </Skeleton>
      ) : (
        <View style={styles.groups}>
          <RowGroup title={t('language.languageGroup')} testID={`${ROUTE}.languageGroup`}>
            <RadioRows<Language>
              label={t('language.languageGroup')}
              value={language}
              onChange={chooseLanguage}
              options={[
                // Each language in its own name, so it can be found whatever is set now.
                { value: 'de', label: t('language.names.de') },
                { value: 'en', label: t('language.names.en') },
              ]}
              testID={`${ROUTE}.language`}
            />
          </RowGroup>
          <RowGroup title={t('language.powerGroup')} testID={`${ROUTE}.powerGroup`}>
            <RadioRows<PowerDisplay>
              label={t('language.powerGroup')}
              value={display}
              onChange={choosePower}
              disabled={member && !online}
              options={POWER_DISPLAYS.map((option) => ({
                value: option,
                label: t(`language.power.${option}`),
                helper: format.power(EXAMPLE_PS, 'ps', option),
              }))}
              testID={`${ROUTE}.power`}
            />
          </RowGroup>
          <RowGroup title={t('language.exampleGroup')} testID={`${ROUTE}.exampleGroup`}>
            <View style={styles.example} role="status" aria-live="polite">
              <Text variant="supporting" color="text.secondary">
                {t('language.exampleLabel')}
              </Text>
              <Text variant="bodyStrong" testID={`${ROUTE}.example`}>
                {format.power(EXAMPLE_PS, 'ps', display)}
              </Text>
              <Text variant="supporting" color="text.secondary">
                {t('language.metricNote')}
              </Text>
            </View>
          </RowGroup>
        </View>
      )}
    </SettingsPage>
  );
}
