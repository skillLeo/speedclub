import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Hairline, Sheet, Text } from '@/ui';

import { SHORTCUT_ROWS } from './keys';

const ID = 'shell.shortcuts';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[8], paddingBottom: t.space[8] },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], justifyContent: 'space-between', minHeight: t.size.row.single },
  label: { flex: 1, minWidth: 0 },
  keys: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: t.space[4] },
  cap: {
    alignItems: 'center',
    borderColor: t.color.border.default,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
    minWidth: t.size.specChip,
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[2],
  },
}));

/** `?`: every shortcut with its keys. `mod` reads ⌘ on Apple keyboards and Ctrl elsewhere. */
export function ShortcutSheet({ visible, onClose, modifier }: { visible: boolean; onClose: () => void; modifier: string }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('system.shortcuts.title')} narrow expandable={false} testID={ID}>
      <View style={styles.body}>
        <Text variant="callout" color="text.secondary">
          {t('system.shortcuts.note')}
        </Text>
        {SHORTCUT_ROWS.map((row, index) => {
          const keys = row.keys.map((key) => (key === 'mod' ? modifier : key));
          const sequence = row.keys[0] === 'G';
          return (
            <View key={row.id}>
              <View
                style={styles.row}
                accessible
                aria-label={`${t(`system.shortcuts.rows.${row.id}`)}: ${keys.join(sequence ? ` ${t('system.shortcuts.then')} ` : ' + ')}`}
                testID={`${ID}.${row.id}`}
              >
                <Text variant="body" style={styles.label}>
                  {t(`system.shortcuts.rows.${row.id}`)}
                </Text>
                <View style={styles.keys} aria-hidden>
                  {keys.map((key, at) => (
                    <View key={`${key}.${at}`} style={styles.keys}>
                      {at > 0 ? (
                        <Text variant="caption" color="text.tertiary">
                          {sequence ? t('system.shortcuts.then') : '+'}
                        </Text>
                      ) : null}
                      <View style={styles.cap}>
                        <Text variant="callout">{key}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
              {index < SHORTCUT_ROWS.length - 1 ? <Hairline /> : null}
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}
