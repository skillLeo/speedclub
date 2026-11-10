import { View } from 'react-native';

import { createStyles, systemMapping, themes, type ThemeName, type ThemePreference } from '@/theme';

/** Five tab slots, as in the real bar. */
const TABS = [0, 1, 2, 3, 4] as const;
/** A phone screen in portrait. */
const SCREEN_RATIO = 3 / 4;

const useStyles = createStyles((t) => ({
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
  const styles = useStyles();
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
  const styles = useStyles();
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
