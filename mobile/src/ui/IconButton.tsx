import type { ComponentRef, Ref } from 'react';
import type { StyleProp, View, ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, type ColorToken } from '@/theme';

import { Icon, type IconName, type IconWeight } from './icons/Icon';
import { PressableScale } from './PressableScale';
import { Spinner } from './Spinner';
import { toast } from './toast';

export type IconButtonProps = {
  icon: IconName;
  /** Required: an icon-only control has no other name. */
  label: string;
  onPress?: () => void;
  /** `onPhoto`: a 36 circle inside the 44 target, for controls over photography. */
  variant?: 'default' | 'onPhoto';
  weight?: IconWeight;
  /** Glyph colour; defaults to text.primary, onPhoto.primary on a photo. */
  color?: ColorToken;
  /** A toggle: fill glyph when on; `aria-pressed` on web, the selected state on native. */
  selected?: boolean;
  disabled?: boolean;
  /** As Button's `locked`: looks disabled, and a press shows this reason as a toast instead of running `onPress`. */
  locked?: string | null;
  loading?: boolean;
  /**
   * `inset` (ADR-118) inside a field, where the outer ring (2 + 2) would end on the field's frame and merge with it, as
   * the password toggle of TextInput. Ignored on a photo.
   */
  ring?: 'default' | 'inset';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<ComponentRef<typeof View>>;
};

const useStyles = createStyles((t) => ({
  target: {
    alignItems: 'center',
    height: t.size.iconButton,
    justifyContent: 'center',
    width: t.size.iconButton,
  },
  visual: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    flexGrow: 0,
    height: t.size.iconButton,
    justifyContent: 'center',
    width: t.size.iconButton,
  },
  hover: { backgroundColor: t.color.state.hover },
  pressed: { backgroundColor: t.color.state.pressed },
  photoVisual: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.full,
    flexGrow: 0,
    height: t.size.iconButtonOnPhoto,
    justifyContent: 'center',
    width: t.size.iconButtonOnPhoto,
  },
}));

/** §8: 44 × 44 target, 24 glyph, pressed background `state.pressed`. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'default',
  weight,
  color,
  selected,
  disabled: disabledProp = false,
  locked,
  loading = false,
  ring = 'default',
  style,
  testID,
  ref,
}: IconButtonProps) {
  const styles = useStyles();
  const onPhoto = variant === 'onPhoto';
  const disabled = disabledProp || Boolean(locked);
  const glyph: ColorToken = disabled ? (onPhoto ? 'onPhoto.secondary' : 'text.disabled') : (color ?? (onPhoto ? 'onPhoto.primary' : 'text.primary'));

  return (
    <PressableScale
      ref={ref}
      role="button"
      aria-label={label}
      aria-busy={loading}
      {...(selected === undefined ? {} : isWeb ? ({ "aria-pressed": selected } as object) : { "aria-selected": selected })}
      aria-disabled={disabled || undefined}
      // Undefined, not false, while only locked: a `disabled` of false would override aria-disabled in the accessibility state,
      // and a true one would swallow the press that says why.
      disabled={disabledProp || undefined}
      feedback={!loading && !locked}
      ring={onPhoto ? 'onPhoto' : ring}
      onPress={() => {
        if (locked) {
          toast(locked, { testID: testID ? `${testID}.locked` : undefined });
          return;
        }
        if (!loading) onPress?.();
      }}
      testID={testID}
      style={[styles.target, style]}
      contentStyle={(state) =>
        onPhoto
          ? styles.photoVisual
          : [styles.visual, state.pressed ? styles.pressed : state.hovered ? styles.hover : null]
      }
    >
      {loading ? (
        <Spinner decorative color={glyph} />
      ) : (
        <Icon name={icon} size={24} weight={weight ?? (selected ? 'fill' : 'regular')} color={glyph} />
      )}
    </PressableScale>
  );
}
