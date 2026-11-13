import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space, typography } from '@/theme';
import { Icon, PressableScale, Text, type IconName } from '@/ui';

import { REACTION_KEYS, type MessageReaction, type ReactionKey } from '../model';

/**
 * [SIG] `sig.msg_reactions` without emoji (09 §7.8, skill §5, M4.11 carry-over): every reaction is a glyph from the icon map, with
 * its spoken name. 09 §7.8 asks for "Gefällt mir" (Phosphor Heart) + Stark · Sauber · Tief · Laut (the build reaction glyphs); the
 * API still takes the six v1 keys only (lane B gap: add `stark`, `sauber`, `tief`, `laut` to `MessageReaction`). Until then the
 * picker offers the v1 keys that have a fitting glyph (Herz, Daumen hoch, Zielflagge); a v1 reaction without one (Feuer, Lachen,
 * Staunen: an emoji face or a banned glyph) still shows on a message as its word, never as an emoji.
 */
export const REACTION_GLYPH: Partial<Record<ReactionKey, IconName>> = {
  heart: 'heart',
  thumbs_up: 'thumbs-up',
  flag: 'flag-checkered',
};

/** The picker's reactions in 09 §7.8 order: "Gefällt mir" first. */
export const PICKER_KEYS: readonly ReactionKey[] = (['heart', 'thumbs_up', 'flag'] as const).filter((key) => REACTION_KEYS.includes(key));

/** Caption line, 2 above and below, the 1 border: the hit area grows from here to 44. */
const CHIP_HEIGHT = typography.caption.lineHeight + space[2] * 2 + size.border.control * 2;

const useStyles = createStyles((t) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[4], marginTop: t.space[4] },
  chip: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.subtle,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
    flexDirection: 'row',
    gap: t.space[4],
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[2],
  },
  chipMine: { borderColor: t.color.text.primary },
  picker: { flexDirection: 'row', justifyContent: 'space-between' },
  pick: {
    alignItems: 'center',
    borderRadius: t.radius.full,
    height: t.size.touchMin,
    justifyContent: 'center',
    width: t.size.touchMin,
  },
  pickMine: { backgroundColor: t.color.state.selected },
}));

export type ReactionChipsProps = {
  reactions: readonly MessageReaction[];
  onToggle: (key: ReactionKey, mine: boolean) => void;
  testID: string;
};

/** Under a bubble: one chip per reaction with its count; yours is outlined and a tap takes it back. */
export function ReactionChips({ reactions, onToggle, testID }: ReactionChipsProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const format = useFormat();
  return (
    <View style={styles.chips} testID={testID}>
      {reactions
        .filter((reaction) => reaction.count > 0)
        .map((reaction) => {
          const name = t(`reactions.${reaction.key}`);
          const counted = t('reactions.count', { label: name, formatted: format.number(reaction.count) });
          return (
            <PressableScale
              key={reaction.key}
              role="button"
              aria-label={reaction.mine ? t('reactions.mine', { label: counted }) : counted}
              aria-pressed={reaction.mine}
              onPress={() => onToggle(reaction.key, reaction.mine)}
              visualHeight={CHIP_HEIGHT}
              contentStyle={[styles.chip, reaction.mine ? styles.chipMine : null]}
              testID={`${testID}.${reaction.key}`}
            >
              <ReactionGlyph reactionKey={reaction.key} size={16} label={name} />
              {reaction.count > 1 ? (
                <Text variant="caption" color="text.secondary" aria-hidden>
                  {format.number(reaction.count)}
                </Text>
              ) : null}
            </PressableScale>
          );
        })}
    </View>
  );
}

export type ReactionPickerProps = {
  /** Your current reaction: picking it again removes it. */
  mine: ReactionKey | null;
  onPick: (key: ReactionKey | null) => void;
  testID: string;
};

/** The row of six at the top of the message actions sheet. */
export function ReactionPicker({ mine, onPick, testID }: ReactionPickerProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  return (
    <View style={styles.picker} role="toolbar" aria-label={t('actions.react')} testID={testID}>
      {PICKER_KEYS.map((key) => (
        <PressableScale
          key={key}
          role="button"
          aria-label={key === mine ? t('reactions.remove') : t(`reactions.${key}`)}
          aria-pressed={key === mine}
          onPress={() => onPick(key === mine ? null : key)}
          contentStyle={[styles.pick, key === mine ? styles.pickMine : null]}
          testID={`${testID}.${key}`}
        >
          <ReactionGlyph reactionKey={key} size={24} label={t(`reactions.${key}`)} />
        </PressableScale>
      ))}
    </View>
  );
}

/** The glyph of a reaction, or its word where it has none (a v1 key from before 2.0). Hidden from readers: the control names it. */
function ReactionGlyph({ reactionKey, size: glyphSize, label }: { reactionKey: ReactionKey; size: 16 | 24; label: string }) {
  const glyph = REACTION_GLYPH[reactionKey];
  if (glyph) {
    return (
      <View aria-hidden>
        <Icon name={glyph} size={glyphSize} weight={reactionKey === 'heart' ? 'fill' : 'regular'} color="text.primary" />
      </View>
    );
  }
  return (
    <Text variant="caption" aria-hidden numberOfLines={1} hyphenate={false}>
      {label}
    </Text>
  );
}
