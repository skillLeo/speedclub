import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { createStyles, fixedThemePreference, setThemePreference, useBreakpoint, useThemePreference, type ThemePreference } from '@/theme';
import { PressableScale, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { keyOf, useRovingKeys } from '@/ui/useRovingKeys';

import { SettingsPage } from '../components/SettingsPage';
import { ThemePreview } from '../components/ThemePreview';

/** FS-12 order. */
export const THEME_OPTIONS: readonly ThemePreference[] = ['carbon', 'black', 'light', 'system'];

const useStyles = createStyles((t) => ({
  intro: { marginBottom: t.space[24] },
  grid: { columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[24] },
  // Two columns on a phone, four from the tablet on; the gap takes the rest.
  cellPhone: { flexBasis: '40%', flexGrow: 1 },
  cellWide: { flexBasis: '20%', flexGrow: 1 },
  // DQ-127: the ring sits on the selection frame, one outline and not two, and closes around the labels with 4 of air below them.
  option: { borderRadius: t.radius.lg, gap: t.space[8], paddingBottom: t.space[4] },
  // FS-12: the selected card gets a 2-pt text.primary outline. Unselected keeps the same border, transparent, so nothing
  // moves on selection.
  frame: {
    borderColor: 'transparent',
    borderRadius: t.radius.lg,
    borderWidth: t.size.border.focusRing,
    padding: t.space[2],
  },
  frameSelected: { borderColor: t.color.text.primary },
  labels: { gap: t.space[2], paddingHorizontal: t.space[4] },
  note: { marginTop: t.space[24] },
  skeletonCell: { gap: t.space[8], paddingBottom: t.space[4] },
}));

/** Arrow up and down move like left and right: the grid wraps, so its reading order is the radio order. */
const VERTICAL_KEYS: Readonly<Record<string, string>> = { ArrowDown: 'ArrowRight', ArrowUp: 'ArrowLeft' };

/** The body of SET-10, also the detail beside the list on desktop SET-01 for a guest. */
export function AppearanceBody() {
  const { t } = useTranslation('settings');
  const { t: viewAsT } = useTranslation('auth');
  const styles = useStyles();
  const qaState = useQaState();
  const { kind } = useBreakpoint();
  const preference = useThemePreference();
  const signedIn = useSessionStore((state) => state.status === 'member');
  // View-as (m3.2-contract §3): the theme is neither changed nor stored for the member.
  const readOnly = useViewAsReadOnly();
  const selectedIndex = Math.max(0, THEME_OPTIONS.indexOf(preference));

  const select = (index: number) => {
    const next = THEME_OPTIONS[index];
    if (!next || next === preference || readOnly) return;
    haptics.selection();
    setThemePreference(next);
  };
  const roving = useRovingKeys(
    THEME_OPTIONS.map(() => true),
    selectedIndex,
    select,
  );
  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const key = keyOf(event);
    roving.onKeyDown(key && VERTICAL_KEYS[key] ? { key: VERTICAL_KEYS[key], preventDefault: () => event.preventDefault?.() } : event);
  };

  const cell = kind === 'phone' ? styles.cellPhone : styles.cellWide;
  const note = fixedThemePreference() ? null : readOnly ? viewAsT('viewAs.readOnly') : signedIn ? t('appearance.noteSynced') : t('appearance.noteDevice');

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
                <SkeletonBlock aspectRatio={3 / 4} corner="lg" />
                <SkeletonText variant="labelS" width="60%" />
              </View>
            ))}
          </View>
        </Skeleton>
      ) : (
        <View
          role="radiogroup"
          aria-label={t('appearance.groupLabel')}
          style={styles.grid}
          testID="SET-10.options"
          {...({ onKeyDown } as object)}
        >
          {THEME_OPTIONS.map((option, index) => {
            const selected = option === preference;
            const label = t(`appearance.options.${option}`);
            const hint = t(`appearance.hints.${option}`);
            return (
              <PressableScale
                key={option}
                ref={roving.setRef(index)}
                role="radio"
                aria-checked={selected}
                aria-disabled={readOnly || undefined}
                disabled={readOnly}
                aria-label={`${label}, ${hint}`}
                tabIndex={selected ? 0 : -1}
                ring="inset"
                onPress={() => select(index)}
                style={cell}
                contentStyle={styles.option}
                testID={`SET-10.option.${option}`}
              >
                <View style={[styles.frame, selected ? styles.frameSelected : null]} testID={`SET-10.option.${option}.frame`}>
                  <ThemePreview preference={option} />
                </View>
                <View style={styles.labels}>
                  <Text variant="labelS" selectable={false}>
                    {label}
                  </Text>
                  <Text variant="helper" color="text.secondary" selectable={false}>
                    {hint}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </View>
      )}
      {note ? (
        <Text variant="supporting" color="text.secondary" style={styles.note} testID="SET-10.note">
          {note}
        </Text>
      ) : null}
    </>
  );
}

/** SET-10. A choice applies at once, with the provider's 200 ms crossfade, and is stored; signed in, it also syncs. */
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
