import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons/Icon';
import { Photo, ratioOf } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';

import type { BeforeAfterIssue } from '../model';

export type SlotPhoto = { uri: string; key: string };
export type SlotName = 'before' | 'after';

export type BeforeAfterSlotsProps<T extends SlotPhoto> = {
  before: T | null;
  after: T | null;
  /** Opens the picker (and the plate blur editor) for one slot; a filled slot is replaced. */
  onPick: (slot: SlotName) => void;
  onRemove: (slot: SlotName) => void;
  /** Shown under the slots after a "Posten" without both photos. */
  issues: readonly BeforeAfterIssue[];
  disabled?: boolean;
  /** `UPD-01`: ids are `UPD-01.beforeAfter.before`, `.after`, `.before.remove`, `.error.before`. */
  routeId: string;
};

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.space[8] },
  slot: { flex: 1, minWidth: 0 },
  visual: { borderRadius: t.radius.sm, overflow: 'hidden' },
  // The empty slot: the photo's box on the raised surface, a glyph and the action, no dashed frame (hairlines, not boxes).
  empty: {
    alignItems: 'center',
    aspectRatio: ratioOf('4:5'),
    backgroundColor: t.color.bg.raised,
    gap: t.space[8],
    justifyContent: 'center',
    padding: t.space[12],
  },
  emptyError: { borderColor: t.color.accent.fg, borderWidth: t.size.border.control },
  emptyText: { textAlign: 'center' },
  badge: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    left: t.space[8],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
    position: 'absolute',
    top: t.space[8],
  },
  remove: { position: 'absolute', right: 0, top: 0 },
  errors: { gap: t.space[4] },
}));

/**
 * UPD-01 "Vorher/Nachher" (contract §2): two photo slots side by side, as the pair will stand in Verlauf. Each slot takes one photo
 * through the picker and the M5.9a plate blur editor; a filled slot shows its badge and can be replaced or removed.
 */
export function BeforeAfterSlots<T extends SlotPhoto>({ before, after, onPick, onRemove, issues, disabled = false, routeId }: BeforeAfterSlotsProps<T>) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const id = `${routeId}.beforeAfter`;
  const slot = (name: SlotName, photo: T | null) => {
    const missing = issues.includes(name === 'before' ? 'beforeMissing' : 'afterMissing');
    const label = name === 'before' ? t('composer.before') : t('composer.after');
    const pickLabel = photo
      ? name === 'before'
        ? t('composer.replaceBefore')
        : t('composer.replaceAfter')
      : name === 'before'
        ? t('composer.pickBefore')
        : t('composer.pickAfter');
    return (
      <View style={styles.slot}>
        <PressableScale
          role="button"
          aria-label={pickLabel}
          onPress={() => onPick(name)}
          disabled={disabled}
          contentStyle={styles.visual}
          testID={`${id}.${name}`}
        >
          {photo ? (
            <Photo source={photo.uri} aspect="4:5" corner="none" label={label}>
              <View style={styles.badge} aria-hidden>
                <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false}>
                  {label}
                </Text>
              </View>
            </Photo>
          ) : (
            <View style={[styles.empty, missing ? styles.emptyError : null]}>
              <Icon name="image" size={24} color="text.secondary" />
              <Text variant="callout" color="text.primary" style={styles.emptyText}>
                {pickLabel}
              </Text>
            </View>
          )}
        </PressableScale>
        {photo ? (
          <View style={styles.remove}>
            <IconButton icon="x" variant="onPhoto" label={t('composer.removePhoto')} onPress={() => onRemove(name)} disabled={disabled} testID={`${id}.${name}.remove`} />
          </View>
        ) : null}
      </View>
    );
  };
  return (
    <View style={styles.errors}>
      <View style={styles.row}>
        {slot('before', before)}
        {slot('after', after)}
      </View>
      {issues.map((issue) => (
        <Text key={issue} variant="callout" color="accent.fg" role="alert" testID={`${id}.error.${issue === 'beforeMissing' ? 'before' : 'after'}`}>
          {issue === 'beforeMissing' ? t('composer.beforeMissing') : t('composer.afterMissing')}
        </Text>
      ))}
    </View>
  );
}
