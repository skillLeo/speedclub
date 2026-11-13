import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { useCollections } from '@/api/queries/social2';
import { BuildWallSkeleton } from '@/features/discover/components/BuildWall';
import { WALL_COLUMNS_BY_KIND } from '@/features/discover/layout';
import { NotFoundScreen } from '@/features/system/screens/NotFoundScreen';
import { useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { ErrorState, Header, Screen, Skeleton } from '@/ui';

import { COLLECTIONS_FLAG } from '../components/ProfileTabs';

const ROUTE = 'PROF-05';
const EDGES: readonly Edge[] = ['left', 'right'];
const SKELETON_CELLS = 6;

const useStyles = createStyles((t) => ({
  body: { flex: 1, paddingTop: t.space[16] },
}));

/** Where `/profile/saved` leads: the "Gespeichert" collection, else the collections, or nothing yet while they load. */
export function savedTarget(
  status: 'loading' | 'guest' | 'member' | string,
  collections: readonly { id: string; is_default: boolean }[] | undefined,
): string | null {
  if (status === 'guest') return '/profile/collections';
  if (status !== 'member' || !collections) return null;
  const saved = collections.find((collection) => collection.is_default);
  return saved ? `/profile/collections/${saved.id}` : '/profile/collections';
}

/**
 * PROF-05 (DQ-1087, 09 §8.6): collections replace the single saved list, so the route stays for links and old apps but shows no
 * list of its own: it opens the "Gespeichert" collection (COL-02, the 2.0 wall), or COL-01 for a guest or without a default
 * collection. While the collections load it holds COL-02's geometry; a failed load offers a retry. Without the collections flag
 * the route does not exist.
 */
export function SavedScreen() {
  const enabled = useFlag(COLLECTIONS_FLAG);
  return enabled ? <SavedRedirect /> : <NotFoundScreen />;
}

function SavedRedirect() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const status = useSessionStore((state) => state.status);
  const back = useBack('/profile');
  const query = useCollections();
  const { kind, gutter } = useBreakpoint();
  const { width } = useWindowDimensions();
  const held = qaState === 'loading' || qaState === 'error' || qaState === 'offline';
  const target = held ? null : savedTarget(status, query.data);

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  const failed = qaState === 'error' || qaState === 'offline' || (status === 'member' && query.isError);
  const wallWidth = Math.min(width, layout.contentMax) - (kind === 'phone' ? 0 : 2 * gutter);
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" title={t('saved.title')} onBack={back} testID={`${ROUTE}.header`} />
      <View style={[styles.body, failed ? { paddingHorizontal: gutter } : kind === 'phone' ? null : { paddingHorizontal: gutter }]}>
        {failed ? (
          <ErrorState
            title={t('collections.listErrorTitle')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            testID={`${ROUTE}.error`}
          />
        ) : (
          <Skeleton testID={`${ROUTE}.skeleton`}>
            <BuildWallSkeleton width={wallWidth} columns={WALL_COLUMNS_BY_KIND[kind]} count={SKELETON_CELLS} />
          </Skeleton>
        )}
      </View>
    </Screen>
  );
}
