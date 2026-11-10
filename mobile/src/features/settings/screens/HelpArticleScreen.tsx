import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, space } from '@/theme';
import { EmptyState, ErrorState, Skeleton, SkeletonText, Text, useCollapsingHeader } from '@/ui';

import { SettingsPage } from '../components/SettingsPage';
import { Markdown } from '../markdown/Markdown';
import { parseMarkdown } from '../markdown/parse';
import { useHelpArticle } from '@/api/queries/settings';

const ROUTE = 'SET-14';
/** An article key as the server seeds them: lowercase words with dashes or underscores. */
const ARTICLE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const useStyles = createStyles((t) => ({
  heading: { marginBottom: t.space[24] },
  skeletonSection: { gap: t.space[12], marginTop: t.space[24] },
}));

function ArticleSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.article.skeleton`}>
      <View style={styles.heading}>
        <SkeletonText variant="titleL" width="60%" />
      </View>
      <SkeletonText variant="body" lines={4} />
      <View style={styles.skeletonSection}>
        <SkeletonText variant="body" lines={3} />
      </View>
    </Skeleton>
  );
}

/** SET-14 reader /settings/help/[key]: the article in the app's language, through the legal texts' Markdown renderer. */
export function HelpArticleScreen() {
  const { t, i18n } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const params = useLocalSearchParams<{ key?: string | string[] }>();
  const requested = Array.isArray(params.key) ? params.key[0] : params.key;
  const key = requested && ARTICLE_KEY.test(requested) ? requested : null;
  const query = useHelpArticle(i18n.language === 'en' ? 'en' : 'de', key);
  const article = query.data;
  const parsed = useMemo(() => (article ? parseMarkdown(article.bodyMd) : null), [article]);
  const notFound = key === null || (query.error instanceof ApiError && query.error.status === 404);
  const collapsing = useCollapsingHeader();
  const title = article ? (parsed?.title ?? article.title) : undefined;

  let body: ReactNode;
  if (qaState === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && !notFound && qaState !== 'error' && qaState !== 'empty')) {
    body = <ArticleSkeleton />;
  } else if (qaState === 'empty' || (notFound && !article)) {
    body = (
      <EmptyState
        icon="info"
        title={t('help.notFoundTitle')}
        body={t('help.notFoundBody')}
        action={{ label: t('help.toList'), onPress: () => router.replace('/settings/help'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'error' || !article || !parsed) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('help.articleErrorTitle')}
        message={offline ? t('help.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.article.error`}
      />
    );
  } else {
    body = (
      <View testID={`${ROUTE}.article.${article.key}`}>
        <Text
          variant="titleL"
          role="heading"
          {...({ 'aria-level': 1 } as object)}
          style={styles.heading}
          onLayout={(event) => collapsing.collapseAt.set(event.nativeEvent.layout.height + space[8])}
          testID={`${ROUTE}.article.title`}
        >
          {title}
        </Text>
        <Markdown blocks={parsed.blocks} testID={`${ROUTE}.article.body`} />
      </View>
    );
  }

  return (
    <SettingsPage
      routeId={`${ROUTE}.reader`}
      title={title}
      collapsing={collapsing}
      fallback="/settings/help"
      offlineLabel={t('help.offlineBanner')}
      focusableScroll
      section="help"
    >
      {body}
    </SettingsPage>
  );
}
