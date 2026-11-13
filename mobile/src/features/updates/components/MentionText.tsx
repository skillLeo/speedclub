import { useRouter } from 'expo-router';

import { Text } from '@/ui';

import { mentionSegments } from '../model';

export type MentionTextProps = {
  text: string;
  /** The members the API resolved for this text (`mentions[].username`): only these become links. */
  usernames: readonly string[];
  testID?: string;
};

/** A post's text with its allowed @mentions as links to the member (PROF-02). Plain "@name" stays text (ADR-436 b). */
export function MentionText({ text, usernames, testID }: MentionTextProps) {
  const router = useRouter();
  const segments = mentionSegments(text, usernames);
  return (
    <Text variant="body" testID={testID}>
      {segments.map((segment, index) =>
        segment.kind === 'mention' ? (
          <Text
            key={index}
            variant="bodyStrong"
            role="link"
            onPress={() => router.push({ pathname: '/u/[username]', params: { username: segment.username } })}
            testID={testID ? `${testID}.mention.${segment.username}` : undefined}
          >
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}
