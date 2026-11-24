import { useLocalSearchParams } from 'expo-router';

import { ForumListScreen } from '@/features/forum/screens/ForumListScreen';

export default function Route() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const value = typeof slug === 'string' ? slug : '';
  // A new category remounts the page, so its filters start over.
  return <ForumListScreen key={value} routeId="FOR-02" categorySlug={value} />;
}
