import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text, type IconName } from '@/ui';
import { phosphorIcons } from '@/ui/icons/Icon';
import { autoIcons } from '@/ui/icons/auto';

import { Group, SectionScreen } from '../parts';

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  cell: { flexBasis: '40%', flexGrow: 1, gap: t.space[4] },
  glyphs: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
}));

function Cell({ name, fill = false }: { name: IconName; fill?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.cell}>
      <View style={styles.glyphs}>
        <Icon name={name} size={16} />
        <Icon name={name} size={20} />
        <Icon name={name} size={24} />
        {fill ? <Icon name={name} size={24} weight="fill" /> : null}
      </View>
      <Text variant="caption" color="text.tertiary">
        {name}
      </Text>
    </View>
  );
}

export function IconsSection() {
  const styles = useStyles();
  return (
    <SectionScreen section="icons" focusableScroll>
      <Group title="Auto-Glyphen" note="16, 20 und 24, eigener Satz auf dem Phosphor-Raster.">
        <View style={styles.grid}>
          {(Object.keys(autoIcons) as IconName[]).map((name) => (
            <Cell key={name} name={name} />
          ))}
        </View>
      </Group>
      <Group title="Phosphor" note="16, 20, 24 regular und 24 fill für aktive Zustände.">
        <View style={styles.grid}>
          {(Object.keys(phosphorIcons) as IconName[]).map((name) => (
            <Cell key={name} name={name} fill />
          ))}
        </View>
      </Group>
    </SectionScreen>
  );
}
