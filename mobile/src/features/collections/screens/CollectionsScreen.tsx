import { useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useCollections } from '@/api/queries/social2';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { EmptyState, ErrorState, Header, HeaderLargeTitle, Screen, Skeleton, Text, useCollapsingHeader } from '@/ui';

import { CollectionsGrid, CollectionsGridSkeleton, useCollectionActions } from '../components/CollectionsGrid';
import { SampleCollections } from '../components/SampleCollections';

const ROUTE = 'COL-01';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  body: { maxWidth: layout.contentMax, paddingBottom: t.space[32], width: '100%' },
  intro: { marginBottom: t.space[24] },
}));

/**
 * COL-01 Sammlungen (09 §7.7, §8.6): the member's private collections as 2 × 2 photo mosaics, "Gespeichert" first, then their
 * order; "Neue Sammlung" as the last tile and in the header. Rename and delete (with Rückgängig) from each tile's menu.
 */
export function CollectionsScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const status = useSessionStore((state) => state.status);
  const header = useCollapsingHeader();
  const padding = useTabBarPadding();
  const back = useBack('/profile');
  const { gutter } = useBreakpoint();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  // The window until the first layout, so the first frame already has its columns.
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const query = useCollections();
  const actions = useCollectionActions(ROUTE);
  const inner = Math.max(0, Math.min(width, layout.contentMax) - 2 * gutter);
  // A member always has "Gespeichert" (created on first use), so the empty state is a collection with nothing in it.
  const collections = qaState === 'empty' ? [] : (query.data ?? []);
  const empty = collections.every((collection) => collection.items_count === 0);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  let body: ReactNode;
  if (status === 'guest') {
    body = (
      <EmptyState
        preview={<SampleCollections width={inner} testID={`${ROUTE}.guest.sample`} />}
        title={t('collections.guestTitle')}
        body={t('collections.guestBody')}
        action={{
          label: t('guest.signIn'),
          onPress: () => {
            clearAuthIntent();
            router.push({ pathname: '/auth/email', params: { returnTo: '/profile/collections' } });
          },
        }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (
    qaState === 'loading' ||
    status === 'loading' ||
    (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'offline')
  ) {
    body = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <CollectionsGridSkeleton width={inner} />
      </Skeleton>
    );
  } else if (qaState === 'error' || qaState === 'offline' || !query.data) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    body = (
      <ErrorState
        title={offline ? t('error.offlineTitle') : t('collections.listErrorTitle')}
        message={offline ? t('collections.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (empty) {
    body = (
      <>
        <EmptyState
          preview={<SampleCollections width={inner} testID={`${ROUTE}.empty.sample`} />}
          title={t('collections.emptyTitle')}
          body={t('collections.emptyBody')}
          action={{ label: t('collections.discover'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.empty`}
        />
      </>
    );
  } else {
    body = (
      <>
        <Text variant="callout" color="text.secondary" style={styles.intro} testID={`${ROUTE}.private`}>
          {t('collections.privateNote')}
        </Text>
        <CollectionsGrid collections={collections} width={inner} actions={actions} routeId={ROUTE} />
      </>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={t('collections.title')}
        scroll={header}
        onBack={back}
        actions={status === 'member' ? [{ icon: 'plus', label: t('collections.new'), onPress: actions.openCreate, testID: `${ROUTE}.add` }] : undefined}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('collections.offlineBanner')} />
      <Animated.ScrollView
        ref={scrollRef}
        {...header.scrollProps}
        style={styles.scroll}
        contentContainerStyle={[styles.content, padding]}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        testID={`${ROUTE}.scroll`}
      >
        <HeaderLargeTitle title={t('collections.title')} scroll={header} testID={`${ROUTE}.title`} />
        <View style={[styles.body, { paddingHorizontal: gutter }]}>{body}</View>
      </Animated.ScrollView>
      {actions.element}
    </Screen>
  );
}
