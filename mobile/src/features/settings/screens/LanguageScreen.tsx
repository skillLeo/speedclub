import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useUpdateMemberSettings, type SettingsPatch } from '@/api/queries/settings';
import {
  DISTANCE_UNITS,
  setDisplayUnits,
  TORQUE_UNITS,
  useDisplayUnits,
  WEIGHT_UNITS,
  type DisplayUnits,
} from '@/lib/displayUnits';
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
/** The other examples of the preview: an M3 Competition's torque and weight, a year of driving. */
export const EXAMPLE_NM = 650;
export const EXAMPLE_KG = 1725;
export const EXAMPLE_KM = 12400;

/** Which field of `PATCH me/settings` each unit is. */
const UNIT_FIELD = { distance: 'distance_unit', torque: 'torque_unit', weight: 'weight_unit' } as const;

type Language = 'de' | 'en';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  example: { gap: t.space[2], paddingHorizontal: ROW_INSET, paddingVertical: t.space[12] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
}));

/**
 * SET-11 /settings/language (09 §7.9, §8.11): Deutsch or English, Leistung (PS/kW/hp), Drehmoment (Nm/lb-ft), Entfernung (km/mi),
 * Gewicht (kg/lb), with a live preview. Everything applies at once. The language syncs to the account through the settings sync
 * (§11); the units are saved to the account directly and kept on the device. Stored values never change their unit.
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
  const units = useDisplayUnits();
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

  /** The same for the other units: at once, then the account; a refusal puts the previous unit back. */
  const chooseUnit = <K extends keyof DisplayUnits>(kind: K, next: DisplayUnits[K]) => {
    if (units[kind] === next) return;
    const previous = units[kind];
    setDisplayUnits({ [kind]: next });
    if (!member) return;
    update.mutate({ [UNIT_FIELD[kind]]: next } as SettingsPatch, {
      onError: (error) => {
        setDisplayUnits({ [kind]: previous });
        toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });
      },
    });
  };

  const loading = qaState === 'loading' || status === 'loading';
  const unitGroup = <K extends keyof DisplayUnits>(kind: K, options: readonly DisplayUnits[K][]) => (
    <RowGroup title={t(`language.${kind}Group`)} testID={`${ROUTE}.${kind}Group`}>
      <RadioRows<DisplayUnits[K]>
        label={t(`language.${kind}Group`)}
        value={units[kind]}
        onChange={(next) => chooseUnit(kind, next)}
        disabled={member && !online}
        options={options.map((option) => ({ value: option, label: t(`language.units.${option}`) }))}
        testID={`${ROUTE}.${kind}`}
      />
    </RowGroup>
  );

  return (
    <SettingsPage routeId={ROUTE} title={t('language.title')} fallback="/settings" offlineLabel={t('language.offlineBanner')} section="language">
      {loading ? (
        <Skeleton testID={`${ROUTE}.skeleton`}>
          <View style={styles.groups}>
            {[2, 3, 2, 2, 2].map((rows, index) => (
              <View key={index} style={styles.skeletonGroup}>
                <SkeletonText variant="callout" width="30%" style={styles.skeletonLabel} />
                <SkeletonBlock height={size.row.single * rows + (index === 1 ? size.row.withThumb : 0)} corner="md" />
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
          {unitGroup('torque', TORQUE_UNITS)}
          {unitGroup('distance', DISTANCE_UNITS)}
          {unitGroup('weight', WEIGHT_UNITS)}
          <RowGroup title={t('language.exampleGroup')} testID={`${ROUTE}.exampleGroup`}>
            <View style={styles.example} role="status" aria-live="polite">
              <Text variant="callout" color="text.secondary">
                {t('language.exampleLabel')}
              </Text>
              <Text variant="bodyStrong" testID={`${ROUTE}.example`}>
                {format.power(EXAMPLE_PS, 'ps', display)}
              </Text>
              <Text variant="bodyStrong" testID={`${ROUTE}.exampleUnits`}>
                {[format.torque(EXAMPLE_NM), format.weight(EXAMPLE_KG), format.distance(EXAMPLE_KM)].join(' · ')}
              </Text>
              <Text variant="callout" color="text.secondary">
                {t('language.metricNote')}
              </Text>
            </View>
          </RowGroup>
        </View>
      )}
    </SettingsPage>
  );
}
