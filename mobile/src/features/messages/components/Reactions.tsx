import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space, typography } from '@/theme';
import { PressableScale, Text } from '@/ui';

import { REACTION_KEYS, type MessageReaction, type ReactionKey } from '../model';

/**
 * [SIG] `sig.msg_reactions`: six fixed reactions (02 §3.6). They are the message's content, drawn as the characters the spec
 * names, since Phosphor has no faces for "laugh" and "wow" and a mixed set would read worse than one consistent set; every one
 * carries its spoken name. The chrome around them stays Phosphor.
 */
export const REACTION_GLYPH: Record<ReactionKey, string> = {
  thumbs_up: '👍', // i18n-ignore
  heart: '❤️', // i18n-ignore
  fire: '🔥', // i18n-ignore
  laugh: '😂', // i18n-ignore
  wow: '😮', // i18n-ignore
  flag: '🏁', // i18n-ignore
};

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
              <Text variant="caption" aria-hidden>
                {REACTION_GLYPH[reaction.key]}
              </Text>
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
      {REACTION_KEYS.map((key) => (
        <PressableScale
          key={key}
          role="button"
          aria-label={key === mine ? t('reactions.remove') : t(`reactions.${key}`)}
          aria-pressed={key === mine}
          onPress={() => onPick(key === mine ? null : key)}
          contentStyle={[styles.pick, key === mine ? styles.pickMine : null]}
          testID={`${testID}.${key}`}
        >
          <Text variant="titleM" aria-hidden>
            {REACTION_GLYPH[key]}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}
