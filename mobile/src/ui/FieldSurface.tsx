import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';

const styles = StyleSheet.create({
  // React Native types only know auto and pointer; this surface puts the caret in the field, so the browser's own applies.
  caret: { cursor: 'text' } as unknown as ViewStyle,
});

type PointerLike = { pointerType?: string };

export type FieldSurfaceProps = {
  children: ReactNode;
  /** Focuses the input. A nested control keeps its own press: its responder stops the click on the way up. */
  onPress: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
};

/**
 * The area around the input of a text field, which focuses the input when pressed. On web a Pressable always carries a
 * tabindex, and React Native Web's focus trap takes the first thing that accepts focus: a dialog would land on this
 * wrapper with the browser's outline, and typed text would be lost. So a plain view takes click and hover there, as
 * Scrim does. Touch never hovers, as with Pressable.
 */
export function FieldSurface({ children, onPress, onHoverIn, onHoverOut, disabled = false, style, testID }: FieldSurfaceProps) {
  if (isWeb) {
    const handlers = disabled
      ? {}
      : {
          onClick: onPress,
          onPointerEnter: (event: PointerLike) => {
            if (event.pointerType !== 'touch') onHoverIn?.();
          },
          onPointerLeave: (event: PointerLike) => {
            if (event.pointerType !== 'touch') onHoverOut?.();
          },
        };
    return (
      <View testID={testID} style={[style, disabled ? null : styles.caret]} {...(handlers as object)}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessible={false}
      testID={testID}
      focusable={false}
      tabIndex={-1}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      style={style}
    >
      {children}
    </Pressable>
  );
}
