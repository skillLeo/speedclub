import { useRouter } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { FeedSuggestion } from '@/api/queries/home';
import { useMyVehicles } from '@/api/queries/profile';
import { FollowButton } from '@/features/profile/components/FollowButton';
import { profileVehicles, variantUrl } from '@/features/profile/media';
import { ownerName } from '@/features/vehicle/model';
import { clearAuthIntent } from '@/state/session';
import { createStyles, size, space } from '@/theme';
import { EmptyState, MemberRow, SectionHeader } from '@/ui';

import { carLabel } from '../model';
import { useFollowState, useOpenMember } from '../navigation';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[24], paddingTop: t.space[8] },
  header: { paddingBottom: t.space[4] },
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/** One suggestion: the §8 member row with Folgen, the car line as its meta. */
const Suggestion = memo(function Suggestion({
  member,
  following,
  divider,
  onOpen,
  testID,
}: {
  member: FeedSuggestion;
  following: boolean;
  divider: boolean;
  onOpen: (username: string) => void;
  testID: string;
}) {
  const name = ownerName(member);
  const meta = [`@${member.username}`, carLabel(member)].filter(Boolean).join(' · ');
  return (
    <MemberRow
      name={name}
      meta={meta}
      avatarUri={variantUrl(member.avatar, size.avatar.md)}
      avatarBlurhash={member.avatar?.blurhash}
      onPress={() => onOpen(member.username)}
      trailing={<FollowButton username={member.username} following={following} name={name} variant="secondary" testID={`${testID}.follow`} />}
      divider={divider}
      inset={space[16]}
      testID={testID}
    />
  );
});

/**
 * Folge ich without anything to show (02 §3.8): members with a car like the viewer's, else active members, each with Folgen. Without
 * suggestions it leads to Entdecken. A follow fills the stream from the next refresh on.
 */
export function FollowingEmpty({ suggestions, routeId }: { suggestions: readonly FeedSuggestion[]; routeId: string }) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  const openMember = useOpenMember();
  const followState = useFollowState();
  // DQ-304: the server suggests builds like the reader's, else active members. Without a car of your own they can only be active
  // members, and the header says so; with one it stays "Vorschläge für dich", true for both.
  const garage = useMyVehicles();
  const withoutCar = garage.data !== undefined && profileVehicles(garage.data).length === 0;
  const empty = (
    <EmptyState
      icon="user"
      title={t('following.empty.title')}
      body={suggestions.length > 0 ? t('following.empty.bodySuggestions') : t('following.empty.body')}
      action={suggestions.length > 0 ? undefined : { label: t('following.empty.discover'), onPress: () => router.navigate('/discover') }}
      testID={`${routeId}.following.empty`}
    />
  );
  if (suggestions.length === 0) return empty;
  return (
    <View style={styles.root}>
      {empty}
      <View testID={`${routeId}.suggestions`}>
        <SectionHeader
          title={withoutCar ? t('following.suggestionsActive') : t('following.suggestions')}
          style={styles.header}
          testID={`${routeId}.suggestions.header`}
        />
        <View style={styles.group}>
          {suggestions.map((member, index) => (
            <Suggestion
              key={member.username}
              member={member}
              following={followState(member.username, member.is_following)}
              divider={index < suggestions.length - 1}
              onOpen={openMember}
              testID={`${routeId}.suggestion.${member.username}`}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Folge ich for a guest: what it is, and the way to an account. Never someone else's stream. */
export function FollowingGuest({ routeId }: { routeId: string }) {
  const { t } = useTranslation('home');
  const router = useRouter();
  return (
    <EmptyState
      icon="user"
      title={t('following.guest.title')}
      body={t('following.guest.body')}
      action={{
        label: t('following.guest.signIn'),
        onPress: () => {
          // A direct way in: nothing the guest tapped earlier belongs to it.
          clearAuthIntent();
          router.push({ pathname: '/sign-in', params: { returnTo: '/' } });
        },
      }}
      testID={`${routeId}.following.guest`}
    />
  );
}
