import { View } from 'react-native';

import { createStyles, useTheme } from '@/theme';
import { Text } from '@/ui';

import { DEPRECATED_COLOURS } from '../data';
import { Group, NoteText, SectionScreen } from '../parts';

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  cell: { alignItems: 'center', flexBasis: '40%', flexDirection: 'row', flexGrow: 1, gap: t.space[12] },
  swatch: {
    borderColor: t.color.border.default,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flexShrink: 0,
    height: t.size.avatar.md,
    width: t.size.avatar.md,
  },
  text: { flex: 1, minWidth: 0 },
}));

/**
 * The token groups of the active theme. `qr.*` is only valid on the QR card, so that group is marked as such. A deprecated
 * role carries "veraltet → Ersatz" (DQ-909).
 */
export function ColourSection() {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <SectionScreen section="colour" focusableScroll>
      {Object.entries(theme.color).map(([group, values]) => (
        <Group key={group} title={group}>
          <View style={styles.grid} dataSet={group === 'qr' ? { qaExempt: 'qr' } : undefined}>
            {Object.entries(values as Record<string, string>).map(([name, value]) => {
              const replacement = DEPRECATED_COLOURS[`${group}.${name}`];
              return (
                <View key={name} style={styles.cell}>
                  <View style={[styles.swatch, { backgroundColor: value }]} />
                  <View style={styles.text}>
                    <Text variant="callout" hyphenate={false}>
                      {name}
                    </Text>
                    {/* DQ-931: a colour value never hyphenates and breaks only after its commas. */}
                    <NoteText variant="caption" color="text.tertiary">
                      {value}
                    </NoteText>
                    {replacement ? (
                      <NoteText variant="caption" color="text.secondary" testID={`DEV-01.colour.deprecated.${group}.${name}`}>
                        {`veraltet → ${replacement}`}
                      </NoteText>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </Group>
      ))}
    </SectionScreen>
  );
}
