import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text, type IconName } from '@/ui';
import { phosphorIcons } from '@/ui/icons/Icon';
import { autoIconGroups, autoIconsWithFill, type AutoIconName } from '@/ui/icons/auto';

import { Group, SectionScreen } from '../parts';

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  cell: { flexBasis: '40%', flexGrow: 1, gap: t.space[4] },
  glyphs: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
}));

function Cell({ name, fill = false, testID }: { name: IconName; fill?: boolean; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.cell} testID={testID}>
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

const FILLED = new Set<AutoIconName>(autoIconsWithFill);

/** Glyph set 2.0 (09 App. C): 256 grid, 16 stroke, round caps and joins; fill only where a selected state needs one. */
const AUTO_GROUPS = [
  { id: 'systems', title: 'Auto-Glyphen · Systeme', note: 'Build-Sheet: Motor bis E-Antrieb. 16, 20, 24, dazu 24 fill, wo ein Auswahlzustand sie braucht.' },
  { id: 'domain', title: 'Auto-Glyphen · Szene', note: 'Garage, QR-Sticker, Prüfstand, Plakette, Treffen, Ausfahrt und Betrieb. Nur regular.' },
  { id: 'reactions', title: 'Auto-Glyphen · Reaktionen', note: 'Stark, Sauber, Tief, Laut: regular und fill für die gewählte Reaktion.' },
] as const;

export function IconsSection() {
  const styles = useStyles();
  return (
    <SectionScreen section="icons" focusableScroll>
      {AUTO_GROUPS.map((group) => (
        <Group key={group.id} title={group.title} note={group.note}>
          <View style={styles.grid} testID={`DEV-01.icons.${group.id}`}>
            {autoIconGroups[group.id].map((name) => (
              <Cell key={name} name={name} fill={FILLED.has(name)} testID={`DEV-01.icons.${group.id}.${name}`} />
            ))}
          </View>
        </Group>
      ))}
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
