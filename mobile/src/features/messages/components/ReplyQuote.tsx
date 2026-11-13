import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles, space } from '@/theme';
import { IconButton, Text } from '@/ui';

import type { ReplyQuote } from '../model';

const useStyles = createStyles((t) => ({
  // A hairline rule on the leading edge, never a box: the quote is part of the bubble (no cards inside cards).
  quote: {
    borderLeftColor: t.color.border.strong,
    borderLeftWidth: t.size.border.control * 2,
    gap: t.space[2],
    paddingLeft: t.space[8],
  },
  bar: {
    alignItems: 'center',
    borderTopColor: t.color.border.hairline,
    borderTopWidth: t.size.border.control,
    flexDirection: 'row',
    gap: t.space[8],
    paddingTop: t.space[8],
  },
  barText: { flex: 1, minWidth: 0 },
}));

/** Who and what a quote shows: "Du" or the other member, then the start of the text, or what was sent instead of text. */
export function useQuoteLines(quote: ReplyQuote, otherName: string): { who: string; what: string } {
  const { t } = useTranslation('messages');
  const who = quote.mine ? t('you') : otherName;
  const what =
    quote.available === false
      ? t('reply.unavailable')
      : quote.kind === 'photo'
        ? t('thread.photo')
        : quote.kind === 'vehicle'
          ? t('reply.vehicle')
          : (quote.excerpt ?? '');
  return { who, what };
}

/** The quote inside a reply's bubble (09 §7.8): who wrote the answered message and its first line. */
export function BubbleQuote({ quote, otherName, own, testID }: { quote: ReplyQuote; otherName: string; own: boolean; testID: string }) {
  const styles = useStyles();
  const { who, what } = useQuoteLines(quote, otherName);
  const tone = own ? 'bubble.ownText' : 'bubble.otherText';
  return (
    <View style={styles.quote} testID={testID}>
      <Text variant="caption" color={tone} numberOfLines={1} hyphenate={false}>
        {who}
      </Text>
      <Text variant="callout" color={tone} numberOfLines={2} hyphenate={false}>
        {what}
      </Text>
    </View>
  );
}

/** Above the composer while answering: "Antwort an Lukas", the quoted line, and a close button. */
export function ReplyBar({
  quote,
  otherName,
  gutter,
  onCancel,
  testID,
}: {
  quote: ReplyQuote;
  otherName: string;
  gutter: number;
  onCancel: () => void;
  testID: string;
}) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const { who, what } = useQuoteLines(quote, otherName);
  return (
    <View style={[styles.bar, { paddingLeft: gutter, paddingRight: gutter - space[12] }]} testID={testID}>
      <View style={[styles.quote, styles.barText]}>
        <Text variant="caption" color="text.secondary" numberOfLines={1} hyphenate={false}>
          {t('reply.to', { name: who })}
        </Text>
        <Text variant="callout" numberOfLines={1} hyphenate={false} testID={`${testID}.text`}>
          {what}
        </Text>
      </View>
      <IconButton icon="x" label={t('reply.cancel')} color="text.secondary" onPress={onCancel} testID={`${testID}.cancel`} />
    </View>
  );
}
