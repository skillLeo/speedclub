import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, PressableScale, SearchBar, Sheet, Text, type IconName } from '@/ui';
import { keyOf } from '@/ui/useRovingKeys';

import { filterSwitcher, moveActive, SWITCHER_GROUPS, type SwitcherGroup, type SwitcherItem } from './switcher';

const ID = 'shell.switcher';

const GROUP_ICONS: Readonly<Record<SwitcherGroup, IconName>> = {
  vehicles: 'garage',
  conversations: 'chats',
  settings: 'gear-six',
  tabs: 'arrow-right',
};

const useStyles = createStyles((t) => ({
  body: { gap: t.space[12], paddingBottom: t.space[8] },
  list: { gap: t.space[2] },
  groupTitle: { paddingBottom: t.space[4], paddingTop: t.space[12] },
  option: { alignItems: 'center', borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, paddingHorizontal: t.space[12] },
  optionActive: { backgroundColor: t.color.state.selected },
  optionText: { flex: 1, gap: t.space[2], minWidth: 0 },
}));

export type QuickSwitcherProps = {
  visible: boolean;
  onClose: () => void;
  items: readonly SwitcherItem[];
  onOpen: (item: SwitcherItem) => void;
};

/**
 * ⌘K / Ctrl K: a sheet with the search field first. Typing filters, the arrow keys move the active entry (announced), Enter
 * opens it, Escape closes. The sheet traps the focus on web, so Tab never leaves it while it is open.
 */
export function QuickSwitcher({ visible, onClose, items, onOpen }: QuickSwitcherProps) {
  const { t } = useTranslation('common');
  return (
    <Sheet visible={visible} onClose={onClose} title={t('system.shortcuts.switcher.title')} narrow testID={ID}>
      {/* Unmounted with the sheet: each opening starts with an empty field and the first entry active. */}
      <SwitcherBody items={items} onOpen={onOpen} />
    </Sheet>
  );
}

function SwitcherBody({ items, onOpen }: Pick<QuickSwitcherProps, 'items' | 'onOpen'>) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterSwitcher(items, query), [items, query]);
  const current = active >= 0 && active < results.length ? active : results.length > 0 ? 0 : -1;
  const groupLabel = (group: SwitcherGroup) => t(`system.shortcuts.switcher.groups.${group}`);

  const activeItem = results[current];
  const announcement = activeItem ? `${activeItem.label}, ${groupLabel(activeItem.group)}, ${current + 1} / ${results.length}` : null;
  // Only when the active entry changes, so arrowing through the list is heard entry by entry.
  useEffect(() => {
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  const onKeyPress = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const key = keyOf(event);
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    event.preventDefault?.();
    setActive(moveActive(current, results.length, key === 'ArrowDown' ? 1 : -1));
  };

  const open = () => {
    const item = results[current];
    if (item) onOpen(item);
  };

  return (
    <View style={styles.body}>
      <SearchBar
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setActive(0);
        }}
        placeholder={t('system.shortcuts.switcher.search')}
        onSubmit={open}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        onKeyPress={onKeyPress}
        testID={`${ID}.search`}
      />
      <Text variant="caption" color="text.tertiary">
        {t('system.shortcuts.switcher.hint')}
      </Text>
      <Text variant="caption" color="text.secondary" role="status" aria-live="polite" testID={`${ID}.count`}>
        {results.length === 0 ? t('system.shortcuts.switcher.empty', { query: query.trim() }) : t('system.shortcuts.switcher.results', { count: results.length })}
      </Text>
      <View {...({ role: 'listbox' } as object)} aria-label={t('system.shortcuts.switcher.title')} style={styles.list}>
        {SWITCHER_GROUPS.map((group) => {
          const entries = results.map((item, index) => ({ item, index })).filter((entry) => entry.item.group === group);
          if (entries.length === 0) return null;
          return (
            <View key={group} role="group" aria-label={groupLabel(group)}>
              <Text variant="caption" color="text.tertiary" style={styles.groupTitle}>
                {groupLabel(group)}
              </Text>
              {entries.map(({ item, index }) => (
                <PressableScale
                  key={item.id}
                  role="option"
                  aria-selected={index === current}
                  aria-label={item.detail ? `${item.label}, ${item.detail}` : item.label}
                  onPress={() => onOpen(item)}
                  onHoverIn={() => setActive(index)}
                  feedback={false}
                  ring="inset"
                  contentStyle={[styles.option, index === current ? styles.optionActive : null]}
                  testID={`${ID}.option.${item.id}`}
                >
                  <Icon name={GROUP_ICONS[group]} size={20} color="text.secondary" />
                  <View style={styles.optionText}>
                    <Text variant="body" numberOfLines={1} hyphenate={false}>
                      {item.label}
                    </Text>
                    {item.detail ? (
                      <Text variant="caption" color="text.secondary" numberOfLines={1}>
                        {item.detail}
                      </Text>
                    ) : null}
                  </View>
                </PressableScale>
              ))}
            </View>
          );
        })}
      </View>
    </View>
  );
}
