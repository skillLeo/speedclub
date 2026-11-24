import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { forumQueryOf, useForumOn } from '@/api/queries/forum';
import { Button } from '@/ui/Button';

/**
 * DISC-02 (10 §7.4 "search includes threads", m5.8-contract §7 `search/threads`): under the builds and members a link to the same
 * words in the forum's own search (FOR-01 `?q=`). Nothing while `forum` is off or the words are too short for the forum's search.
 * Its words live in the `discover` namespace, so DISC-02 loads nothing of the forum feature.
 */
export function ForumSearchLink({ query, routeId }: { query: string; routeId: string }) {
  const { t } = useTranslation('discover');
  const router = useRouter();
  const on = useForumOn();
  const q = forumQueryOf(query);
  if (!on || !q) return null;
  return (
    <Button
      label={t('forumSearch', { query: q })}
      icon="chats"
      variant="tertiary"
      size="m"
      role="link"
      flush="start"
      onPress={() => router.push({ pathname: '/forum', params: { q } } as unknown as Href)}
      testID={`${routeId}.forumSearch`}
    />
  );
}
