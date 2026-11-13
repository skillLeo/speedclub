import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import {
  changeTheme,
  createStyles,
  fixedThemePreference,
  size,
  useBreakpoint,
  useThemePreference,
  type RevealOrigin,
  type ThemePreference,
} from '@/theme';
import { ListRow, RowGroup, Skeleton, SkeletonBlock, SkeletonText, Text, ThemePreviewCard } from '@/ui';
import { setReduceMotionChoice, useHapticsSetting, useMotionPreference, useReduceMotionChoice, type ReduceMotionChoice } from '@/ui/motion';
import { keyOf, useRovingKeys } from '@/ui/useRovingKeys';

import { useAppIcon } from '../appIcon';
import { RadioRows, SwitchRow } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';

/** FS-12 order. */
export const THEME_OPTIONS: readonly ThemePreference[] = ['carbon', 'black', 'light', 'system'];

const useStyles = createStyles((t) => ({
  intro: { marginBottom: t.space[24] },
  grid: { columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[24] },
  // Two columns on a phone, four from the tablet on; the gap takes the rest.
  cellPhone: { flexBasis: '40%', flexGrow: 1 },
  cellWide: { flexBasis: '20%', flexGrow: 1 },
  note: { marginTop: t.space[24] },
  groups: { gap: t.space[32], marginTop: t.space[32] },
  skeletonCell: { gap: t.space[8], paddingBottom: t.space[4] },
}));

/** Arrow up and down move like left and right: the grid wraps, so its reading order is the radio order. */
const VERTICAL_KEYS: Readonly<Record<string, string>> = { ArrowDown: 'ArrowRight', ArrowUp: 'ArrowLeft' };

const MOTION_CHOICES: readonly ReduceMotionChoice[] = ['system', 'always'];

/**
 * The body of SET-10 Darstellung (09 §7.9), also the detail beside the list on desktop SET-01 for a guest: the four
 * ThemePreviewCards with the SM14 circular reveal from the tapped card (flag `theme_reveal`; reduced motion → crossfade), App-Icon
 * (SET-22, native + flag `app_icons`), Haptisches Feedback (native) and Bewegung reduzieren (System · Immer).
 */
export function AppearanceBody() {
  const { t } = useTranslation('settings');
  const { t: viewAsT } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const { kind } = useBreakpoint();
  const preference = useThemePreference();
  const signedIn = useSessionStore((state) => state.status === 'member');
  const revealOn = useFlag('theme_reveal');
  const appIconsOn = useFlag('app_icons');
  const motion = useMotionPreference();
  const [hapticsOn, setHapticsOn] = useHapticsSetting();
  const motionChoice = useReduceMotionChoice();
  const appIcon = useAppIcon();
  // View-as (m3.2-contract §3): the theme is neither changed nor stored for the member.
  const readOnly = useViewAsReadOnly();
  const selectedIndex = Math.max(0, THEME_OPTIONS.indexOf(preference));

  const select = (index: number, origin: RevealOrigin | null = null) => {
    const next = THEME_OPTIONS[index];
    if (!next || next === preference || readOnly) return;
    haptics.selection();
    changeTheme(next, { origin, reveal: revealOn && motion.enabled && !motion.reduced });
  };
  const roving = useRovingKeys(
    THEME_OPTIONS.map(() => true),
    selectedIndex,
    (index) => select(index),
  );
  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const key = keyOf(event);
    roving.onKeyDown(key && VERTICAL_KEYS[key] ? { key: VERTICAL_KEYS[key], preventDefault: () => event.preventDefault?.() } : event);
  };

  const cell = kind === 'phone' ? styles.cellPhone : styles.cellWide;
  const note = fixedThemePreference() ? null : readOnly ? viewAsT('viewAs.readOnly') : signedIn ? t('appearance.noteSynced') : t('appearance.noteDevice');
  const showAppIcon = !isWeb && appIconsOn;

  return (
    <>
      <Text variant="body" color="text.secondary" style={styles.intro} testID="SET-10.intro">
        {t('appearance.intro')}
      </Text>
      {qaState === 'loading' ? (
        <Skeleton testID="SET-10.skeleton">
          <View style={styles.grid}>
            {THEME_OPTIONS.map((option) => (
              <View key={option} style={[cell, styles.skeletonCell]}>
                <SkeletonBlock aspectRatio={3 / 4} corner="xl" />
                <SkeletonText variant="callout" width="60%" />
              </View>
            ))}
          </View>
          <View style={styles.groups}>
            <SkeletonBlock height={size.row.withThumb + size.row.single * 2} corner="md" />
          </View>
        </Skeleton>
      ) : (
        <>
          <View
            role="radiogroup"
            aria-label={t('appearance.groupLabel')}
            style={styles.grid}
            testID="SET-10.options"
            {...({ onKeyDown } as object)}
          >
            {THEME_OPTIONS.map((option, index) => (
              <ThemePreviewCard
                key={option}
                ref={roving.setRef(index)}
                preference={option}
                label={t(`appearance.options.${option}`)}
                hint={t(`appearance.hints.${option}`)}
                selected={option === preference}
                disabled={readOnly}
                tabIndex={option === preference ? 0 : -1}
                onSelect={(origin) => select(index, origin)}
                style={cell}
                testID={`SET-10.option.${option}`}
              />
            ))}
          </View>
          {note ? (
            <Text variant="callout" color="text.secondary" style={styles.note} testID="SET-10.note">
              {note}
            </Text>
          ) : null}
          <View style={styles.groups}>
            {showAppIcon ? (
              <RowGroup title={t('appearance.iconGroup')} testID="SET-10.iconGroup">
                <ListRow
                  icon="circle-half"
                  title={t('rows.appIcon')}
                  value={t(`appIcon.options.${appIcon.current}`)}
                  onPress={() => router.push('/settings/appearance/icon')}
                  inset={ROW_INSET}
                  testID="SET-10.appIcon"
                />
              </RowGroup>
            ) : null}
            <RowGroup title={t('appearance.feedbackGroup')} testID="SET-10.feedbackGroup">
              {isWeb ? null : (
                <SwitchRow
                  title={t('appearance.haptics')}
                  helper={t('appearance.hapticsHelper')}
                  value={hapticsOn}
                  onValueChange={(next) => {
                    setHapticsOn(next);
                    // The one confirmation of the switch, played after it is on (09 §4.8 selection).
                    if (next) haptics.selection();
                  }}
                  divider
                  testID="SET-10.haptics"
                />
              )}
              <View>
                <ListRow title={t('appearance.reduceMotion')} subtitle={t('appearance.reduceMotionHelper')} inset={ROW_INSET} divider />
                <RadioRows<ReduceMotionChoice>
                  label={t('appearance.reduceMotion')}
                  value={motionChoice}
                  onChange={(next) => setReduceMotionChoice(next)}
                  options={MOTION_CHOICES.map((choice) => ({ value: choice, label: t(`appearance.motion.${choice}`) }))}
                  testID="SET-10.reduceMotion"
                />
              </View>
            </RowGroup>
          </View>
        </>
      )}
    </>
  );
}

/** SET-10. A choice applies at once (SM14 reveal or the provider's crossfade) and is stored; signed in, it also syncs. */
export function AppearanceScreen() {
  const { t } = useTranslation('settings');
  return (
    <SettingsPage
      routeId="SET-10"
      title={t('appearance.title')}
      fallback="/settings"
      offlineLabel={t('appearance.offline')}
      section="appearance"
    >
      <AppearanceBody />
    </SettingsPage>
  );
}
