import type { ComponentRef, Ref } from 'react';
import { View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, systemMapping, themes, type RevealOrigin, type ThemeName, type ThemePreference } from '@/theme';

import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** Five tab slots, as in the real bar. */
const TABS = [0, 1, 2, 3, 4] as const;
/** A phone screen in portrait. */
const SCREEN_RATIO = 3 / 4;

const usePreviewStyles = createStyles((t) => ({
  root: { alignSelf: 'stretch', aspectRatio: SCREEN_RATIO, borderRadius: t.radius.md, overflow: 'hidden' },
  // The bezel: the theme's own card outline, so every mock-up keeps an edge on every canvas.
  bezel: { borderRadius: t.radius.md, flex: 1, padding: t.space[4] },
  screen: { borderRadius: t.radius.sm, flex: 1, justifyContent: 'space-between', overflow: 'hidden' },
  body: { gap: t.space[8], padding: t.space[8] },
  title: { borderRadius: t.radius.xs, height: t.space[8], width: '45%' },
  card: { borderRadius: t.radius.xs, gap: t.space[4], padding: t.space[4] },
  photo: { aspectRatio: 16 / 9, borderRadius: t.radius.xs },
  line: { borderRadius: t.radius.xs, height: t.space[4] },
  lineLong: { width: '70%' },
  lineShort: { width: '45%' },
  lineMid: { width: '55%' },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: t.space[8] },
  tab: { alignItems: 'center', gap: t.space[2] },
  indicator: { borderRadius: t.radius.xs, height: t.space[2], width: t.space[8] },
  indicatorSpace: { height: t.space[2] },
  tabIcon: { borderRadius: t.radius.full, height: t.space[8], width: t.space[8] },
  half: { bottom: 0, left: 0, overflow: 'hidden', position: 'absolute', top: 0, width: '50%' },
  halfInner: { height: '100%', width: '200%' },
}));

/** A miniature of the app in one theme, drawn from that theme's tokens: canvas, a card, text lines and the tab bar. */
function Phone({ name }: { name: ThemeName }) {
  const styles = usePreviewStyles();
  const color = themes[name].color;
  return (
    <View style={[styles.bezel, { backgroundColor: color.border.default }]}>
      <View style={[styles.screen, { backgroundColor: color.bg.canvas }]}>
        <View style={styles.body}>
          <View style={[styles.title, { backgroundColor: color.text.primary }]} />
          <View style={[styles.card, { backgroundColor: color.bg.surface }]}>
            <View style={[styles.photo, { backgroundColor: color.bg.raised }]} />
            <View style={[styles.line, styles.lineLong, { backgroundColor: color.text.primary }]} />
            <View style={[styles.line, styles.lineShort, { backgroundColor: color.text.secondary }]} />
          </View>
          <View style={[styles.line, styles.lineMid, { backgroundColor: color.text.tertiary }]} />
        </View>
        <View style={[styles.tabBar, { backgroundColor: color.bg.surface }]}>
          {TABS.map((tab) => (
            <View key={tab} style={styles.tab}>
              {tab === 0 ? (
                <View style={[styles.indicator, { backgroundColor: color.accent.fg }]} />
              ) : (
                <View style={styles.indicatorSpace} />
              )}
              <View style={[styles.tabIcon, { backgroundColor: tab === 0 ? color.text.primary : color.text.tertiary }]} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export type ThemePreviewProps = { preference: ThemePreference; testID?: string };

/**
 * FS-12: the mock-up of a theme choice, rendered from real tokens rather than images. System shows its two themes side by
 * side. Decorative: the option around it carries the name. Its colours belong to other themes than the current one, so
 * the DOM audit treats it like a photo.
 */
export function ThemePreview({ preference, testID }: ThemePreviewProps) {
  const styles = usePreviewStyles();
  return (
    <View aria-hidden dataSet={{ qaExempt: 'photo' }} style={styles.root} testID={testID}>
      {preference === 'system' ? (
        <>
          <Phone name={systemMapping.light} />
          <View style={styles.half}>
            <View style={styles.halfInner}>
              <Phone name={systemMapping.dark} />
            </View>
          </View>
        </>
      ) : (
        <Phone name={preference} />
      )}
    </View>
  );
}

const useCardStyles = createStyles((t) => ({
  // DQ-127: the ring sits on the selection frame, one outline and not two, and closes around the labels with 4 of air below them.
  option: { borderRadius: t.radius.xl, gap: t.space[8], paddingBottom: t.space[4] },
  // FS-12: the selected card gets a 2-pt text.primary outline. Unselected keeps the same border, transparent, so nothing
  // moves on selection.
  frame: {
    borderColor: 'transparent',
    borderRadius: t.radius.xl,
    borderWidth: t.size.border.focusRing,
    padding: t.space[2],
  },
  frameSelected: { borderColor: t.color.text.primary },
  labels: { gap: t.space[2], paddingHorizontal: t.space[4] },
}));

export type ThemePreviewCardProps = {
  preference: ThemePreference;
  label: string;
  /** One line under the name ("Echtes Schwarz für OLED-Displays"). */
  hint: string;
  selected: boolean;
  disabled?: boolean;
  /** Chosen, with the point of the press in window coordinates (SM14's origin), or null for a keyboard press. */
  onSelect: (origin: RevealOrigin | null) => void;
  /** The radio group's roving tab stop (useRovingKeys). */
  tabIndex?: 0 | -1;
  ref?: Ref<ComponentRef<typeof View>>;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * 09 §5 ThemePreviewCard (SET-10): a radio whose visual is the app drawn in that theme's tokens, its name and one line, the
 * 2-pt selection frame. Pressed, it reports where the finger was, so the SM14 circular reveal starts there. The `.frame` child carries the selection outline (DQ-127: the focus ring lies on it).
 */
export function ThemePreviewCard({ preference, label, hint, selected, disabled = false, onSelect, tabIndex, ref, style, testID }: ThemePreviewCardProps) {
  const styles = useCardStyles();
  // The finger is the origin: page coordinates of the press (on the web the page does not scroll, its scrollers do, so they are
  // the window's). A keyboard press has none and gets the crossfade.
  const press = (event?: GestureResponderEvent) => {
    const x = event?.nativeEvent?.pageX;
    const y = event?.nativeEvent?.pageY;
    onSelect(typeof x === 'number' && typeof y === 'number' && (x > 0 || y > 0) ? { x, y } : null);
  };
  return (
    <PressableScale
      ref={ref}
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      aria-label={`${label}, ${hint}`}
      tabIndex={tabIndex}
      ring="inset"
      onPress={press}
      style={style}
      contentStyle={styles.option}
      testID={testID}
    >
      <View style={[styles.frame, selected ? styles.frameSelected : null]} testID={`${testID}.frame`}>
        <ThemePreview preference={preference} />
      </View>
      <View style={styles.labels}>
        <Text variant="callout" selectable={false}>
          {label}
        </Text>
        <Text variant="caption" color="text.secondary" selectable={false}>
          {hint}
        </Text>
      </View>
    </PressableScale>
  );
}
