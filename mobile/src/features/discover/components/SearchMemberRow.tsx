import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { SearchMember } from '@/api/queries/search';
import { useFollowState } from '@/features/home/navigation';
import { FollowButton } from '@/features/profile/components/FollowButton';
import { variantUrl } from '@/features/profile/media';
import { ownerMeta, ownerName } from '@/features/vehicle/model';
import { createStyles, size, space, useTheme } from '@/theme';
import { Avatar, SampleBadges, Text, useSampleBadgeLabels } from '@/ui';
import { joinLabel, LARGE_FONT_SCALE, RowBody, RowDivider, useStacksAtFontScale } from '@/ui/rowParts';

/** The row's inset (`ui/MemberRow`'s `side`): none, the list's column already keeps to the gutter. */
const ROW_SIDE = space[0];

const useStyles = createStyles((t) => ({
  badges: { marginTop: t.space[4] },
  body: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    paddingVertical: t.space[12],
  },
  text: { flex: 1, minWidth: 0 },
  root: { alignItems: 'center', flexDirection: 'row' },
  rootStacked: { alignItems: 'flex-start', flexDirection: 'column' },
  boxInline: { flex: 1, minWidth: 0 },
  boxStacked: { alignSelf: 'stretch' },
  trailingInline: { flexShrink: 0, paddingLeft: t.space[8] },
  // At a large font the button takes its own line at the row's start edge, as in `ui/MemberRow` (`paddingLeft: side`, DQ-427). The row
  // has no inset of its own (its list's column keeps to the gutter), so that edge is 0, on the spacing scale; avatar + 12 = 52 was not.
  trailingStacked: { paddingBottom: t.space[12], paddingLeft: ROW_SIDE },
}));

const NO_BREAK_SPACE = '\u00A0';

export type SearchMemberRowProps = {
  member: SearchMember;
  onOpen: (member: SearchMember) => void;
  divider: boolean;
  testID: string;
};

/**
 * §8 member row with the garage summary of §3.7: avatar 40, name `body.strong`, "@kenji.r34 · Düsseldorf" `supporting`,
 * then "4 Fahrzeuge · Nissan, Toyota", and Folgen M (DQ-326) from `is_following`, never on your own row. The state the member last
 * asked for wins over the search answer until it is read again (useFollowState), so a follow does not flip back on a re-render.
 */
export const SearchMemberRow = memo(function SearchMemberRow({ member, onOpen, divider, testID }: SearchMemberRowProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const name = ownerName(member);
  const meta = ownerMeta(member);
  const garage = member.garage.line.trim();
  const self = member.is_self ? t('members.you') : null;
  const city = member.city?.trim();
  // DQ-203: at a large font "@kenji.r34 · Düsseldorf" no longer fits one line of a phone, so handle and city take a line each, with no
  // separator left over at the end of the first. Below that the line wraps after the "·" and never before it (DQ-231).
  const stacked = useTheme().fontScale >= LARGE_FONT_SCALE && Boolean(city);
  const followState = useFollowState();
  const showFollow = !member.is_self;
  const buttonStacked = useStacksAtFontScale() && showFollow;
  const sampleLabels = useSampleBadgeLabels(member);
  return (
    <View testID={testID}>
      <View style={buttonStacked ? styles.rootStacked : styles.root}>
        <RowBody
          onPress={() => onOpen(member)}
          label={joinLabel([name, self, ...sampleLabels, meta, garage])}
          boxStyle={buttonStacked ? styles.boxStacked : styles.boxInline}
          style={styles.body}
          testID={`${testID}.body`}
        >
          <Avatar
            decorative
            name={name}
            uri={variantUrl(member.avatar, size.avatar.md)}
            blurhash={member.avatar?.blurhash}
            size={size.avatar.md}
          />
          <View style={styles.text}>
            <Text variant="bodyStrong">{self ? `${name} · ${self}` : name}</Text>
            {stacked ? (
              <>
                <Text
                  variant="callout"
                  color="text.secondary"
                  hyphenate={false}
                  testID={`${testID}.handle`}
                >
                  {ownerMeta({ username: member.username, city: null })}
                </Text>
                <Text variant="callout" color="text.secondary" hyphenate={false} testID={`${testID}.city`}>
                  {city}
                </Text>
              </>
            ) : (
              <Text variant="callout" color="text.secondary" hyphenate={false} testID={`${testID}.meta`}>
                {meta.replace(/ (?=·)/, NO_BREAK_SPACE)}
              </Text>
            )}
            {garage ? (
              <Text variant="caption" color="text.tertiary" testID={`${testID}.garage`}>
                {garage}
              </Text>
            ) : null}
            {/* 09 §8.19: the Editorial account and sample members are badged; their counts are hidden by the API. */}
            <SampleBadges flags={member} style={styles.badges} testID={`${testID}.sample`} />
          </View>
        </RowBody>
        {showFollow ? (
          <View style={buttonStacked ? styles.trailingStacked : styles.trailingInline} testID={`${testID}.trailing`}>
            <FollowButton
              username={member.username}
              following={followState(member.username, member.is_following)}
              name={name}
              size="m"
              variant="secondary"
              testID={`${testID}.follow`}
            />
          </View>
        ) : null}
      </View>
      {divider ? <RowDivider inset={ROW_SIDE} lead={size.avatar.md + space[12]} /> : null}
    </View>
  );
});
