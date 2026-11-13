import { View } from 'react-native';

import { concentric, createStyles, size, themes } from '@/theme';

import { BrandWordmark } from './BrandWordmark';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { useRovingKeys } from './useRovingKeys';

/** 09 §7.9 SET-22: three grounds, always the same logo (§8.11). */
export type AppIconKey = 'black' | 'white' | 'carbon';

export const APP_ICON_KEYS: readonly AppIconKey[] = ['black', 'white', 'carbon'];

/** The ground of each icon, from the theme that carries it: Schwarz = the OLED canvas, Weiß = Hell's canvas, Carbon = Carbon's surface. */
const GROUND: Readonly<Record<AppIconKey, string>> = {
  black: themes.black.color.bg.canvas,
  white: themes.light.color.bg.canvas,
  carbon: themes.carbon.color.bg.raised,
};
const LOGO_TONE: Readonly<Record<AppIconKey, 'white' | 'black'>> = { black: 'white', white: 'black', carbon: 'white' };
/** The tile is the launcher icon at a list size; its logo keeps the launcher's margin (≈ 18 % each side). */
const TILE = size.thumb.card;
const LOGO_WIDTH = Math.round(TILE * 0.64);

const useStyles = createStyles((t) => ({
  grid: { columnGap: t.space[16], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[24] },
  option: { alignItems: 'center', borderRadius: t.radius.xl, gap: t.space[8], padding: t.space[4] },
  // The selection frame, as on the theme cards: transparent until chosen, so nothing moves.
  frame: { borderColor: 'transparent', borderRadius: t.radius.xl, borderWidth: t.size.border.focusRing, padding: t.space[2] },
  frameSelected: { borderColor: t.color.text.primary },
  // An icon on a hairline, so the white one keeps its edge on Hell and the black one on Schwarz.
  tile: {
    alignItems: 'center',
    borderColor: t.color.border.subtle,
    // Concentric inside the 20 frame (2 border + 2 padding).
    borderRadius: concentric(t.radius.xl, t.size.border.focusRing + t.space[2]),
    borderWidth: t.size.border.control,
    height: TILE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: TILE,
  },
  label: { textAlign: 'center' },
}));

export type AppIconPickerProps = {
  value: AppIconKey;
  onChange: (next: AppIconKey) => void;
  /** Names of the options, in the UI language. */
  labels: Readonly<Record<AppIconKey, string>>;
  /** Accessible name of the radio group. */
  label: string;
  /** No module to change the icon on this build, or read-only: the current icon stays shown, the others take no taps. */
  disabled?: boolean;
  testID: string;
};

/**
 * 09 §5 AppIconPicker (SET-22, native only, flag `app_icons`): the three launcher icons as a radio group — the same logo on
 * Schwarz (default), Weiß and Carbon. Selected = the 2-pt text.primary frame of the theme cards. Arrow keys move on a keyboard.
 */
export function AppIconPicker({ value, onChange, labels, label, disabled = false, testID }: AppIconPickerProps) {
  const styles = useStyles();
  const selectedIndex = Math.max(0, APP_ICON_KEYS.indexOf(value));
  const roving = useRovingKeys(
    APP_ICON_KEYS.map(() => !disabled),
    selectedIndex,
    (index) => {
      const next = APP_ICON_KEYS[index];
      if (next && next !== value && !disabled) onChange(next);
    },
  );
  return (
    <View
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      style={styles.grid}
      testID={testID}
      {...({ onKeyDown: roving.onKeyDown } as object)}
    >
      {APP_ICON_KEYS.map((key, index) => {
        const selected = key === value;
        return (
          <PressableScale
            key={key}
            ref={roving.setRef(index)}
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            aria-label={labels[key]}
            disabled={disabled}
            tabIndex={selected ? 0 : -1}
            ring="inset"
            onPress={() => (selected ? undefined : onChange(key))}
            contentStyle={styles.option}
            testID={`${testID}.${key}`}
          >
            <View style={[styles.frame, selected ? styles.frameSelected : null]}>
              <View aria-hidden dataSet={{ qaExempt: 'photo' }} style={[styles.tile, { backgroundColor: GROUND[key] }]}>
                <BrandWordmark shape="square" tone={LOGO_TONE[key]} width={LOGO_WIDTH} decorative />
              </View>
            </View>
            <Text variant="callout" style={styles.label} selectable={false}>
              {labels[key]}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
