import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useFormat } from '@/lib/useFormat';
import { createStyles, typeScale, useTheme } from '@/theme';
import { PressableScale, Text } from '@/ui';

const TABULAR = { fontVariant: ['tabular-nums' as const] };
const NO_BREAK = ' ';
/** A stat wraps as a whole: its number never ends a line, and the dot stays with the stat before it. */
const keepTogether = (text: string) => text.replace(/ /g, NO_BREAK);
const SEPARATOR = `${NO_BREAK}· `;

const useStyles = createStyles((t) => ({
  row: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap' },
  // A stat and the dot after it wrap together, so a line never starts with "·".
  item: { alignItems: 'baseline', flexDirection: 'row' },
  link: { borderRadius: t.radius.xs },
}));

export type ProfileStatsProps = {
  stats: { vehicles: number; followers: number; following: number };
  /** PROF-04 on the Follower tab; without it the stat is plain text. */
  onFollowers?: () => void;
  /** PROF-04 on the Folge ich tab. */
  onFollowing?: () => void;
  /** Another member's profile: their second list reads "Folgt", since "Folge ich" would read as yours. */
  member?: { handle: string };
  style?: StyleProp<ViewStyle>;
  /** `.followers` and `.following` for the links. */
  testID: string;
};

/**
 * FS-8 stats, inline and not boxes: "**3** Fahrzeuge · **128** Follower · **87** Folge ich". Follower and Folge ich lead to
 * PROF-04 as links with a 44 target around the line (the visual stays a line of `supporting`). Real numbers only (ADR-114).
 */
export function ProfileStats({ stats, onFollowers, onFollowing, member, style, testID }: ProfileStatsProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const { fontScale } = useTheme();
  const lineHeight = typeScale.bodyStrong.lineHeight * fontScale;
  const followingLabel = member ? t('stats.followingOther') : t('stats.following');

  /** "5 Folge ich" exactly as drawn, no-break spaces included: a link's accessible name starts with it (WCAG 2.5.3). */
  const visible = (value: number, label: string) => `${format.number(value)}${NO_BREAK}${keepTogether(label)}`;
  const stat = (value: number, label: string) => (
    <Text variant="supporting" color="text.secondary">
      <Text variant="bodyStrong" style={TABULAR}>
        {format.number(value)}
      </Text>
      {`${NO_BREAK}${keepTogether(label)}`}
    </Text>
  );
  const link = (value: number, label: string, a11y: string, onPress: (() => void) | undefined, id: string) =>
    onPress ? (
      <PressableScale role="link" aria-label={a11y} onPress={onPress} visualHeight={lineHeight} contentStyle={styles.link} testID={`${testID}.${id}`}>
        {stat(value, label)}
      </PressableScale>
    ) : (
      stat(value, label)
    );
  const dot = (
    <Text variant="supporting" color="text.secondary" aria-hidden>
      {SEPARATOR}
    </Text>
  );

  return (
    <View style={[styles.row, style]} testID={testID}>
      <View style={styles.item}>
        {stat(stats.vehicles, t('stats.vehicles', { count: stats.vehicles }))}
        {dot}
      </View>
      <View style={styles.item}>
        {link(
          stats.followers,
          t('stats.followers', { count: stats.followers }),
          t('stats.followersLink', { label: visible(stats.followers, t('stats.followers', { count: stats.followers })) }),
          onFollowers,
          'followers',
        )}
        {dot}
      </View>
      <View style={styles.item}>
        {link(
          stats.following,
          followingLabel,
          member
            ? t('stats.followingLinkOther', { label: visible(stats.following, followingLabel), name: member.handle })
            : t('stats.followingLink', { label: visible(stats.following, followingLabel) }),
          onFollowing,
          'following',
        )}
      </View>
    </View>
  );
}
