import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { isLegalKey, useLegalDocument } from '@/api/queries/legal';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, space } from '@/theme';
import { EmptyState, ErrorState, Skeleton, SkeletonText, Text, useCollapsingHeader } from '@/ui';

import { SettingsPage } from '../components/SettingsPage';
import { Markdown } from '../markdown/Markdown';
import { parseMarkdown, sectionHeadingIndex } from '../markdown/parse';
import { useLegalMeta } from './LegalListScreen';

const useStyles = createStyles((t) => ({
  heading: { gap: t.space[8], marginBottom: t.space[32] },
  skeletonSection: { gap: t.space[12], marginTop: t.space[32] },
}));

function DocumentSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID="SET-18.skeleton">
      <View style={styles.heading}>
        <SkeletonText variant="title1" width="55%" />
        <SkeletonText variant="callout" width="35%" />
      </View>
      <SkeletonText variant="body" lines={3} />
      {[3, 4].map((lines) => (
        <View key={lines} style={styles.skeletonSection}>
          <SkeletonText variant="headline" width="40%" />
          <SkeletonText variant="body" lines={lines} />
        </View>
      ))}
    </Skeleton>
  );
}

/** SET-18. The text as published for the app's language, rendered by the in-house Markdown subset; offline the last copy. */
export function LegalDocumentScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const meta = useLegalMeta();
  const params = useLocalSearchParams<{ doc?: string | string[]; section?: string | string[] }>();
  const section = Array.isArray(params.section) ? params.section[0] : params.section;
  const requested = Array.isArray(params.doc) ? params.doc[0] : params.doc;
  const key = isLegalKey(requested) ? requested : null;
  const query = useLegalDocument(key);
  const document = query.data;
  const parsed = useMemo(() => (document ? parseMarkdown(document.body_md) : null), [document]);
  const notFound = key === null || (query.error instanceof ApiError && query.error.status === 404);
  // DQ-117: the title scrolls away on a long text, and the header takes it over (§8).
  const collapsing = useCollapsingHeader();
  const title = document && parsed ? (parsed.title ?? document.title) : undefined;
  // `?section=3` (SAFE-01's ground): the page opens on that heading. The three offsets add up to its place in the column.
  const anchorIndex = useMemo(() => (parsed && section ? sectionHeadingIndex(parsed.blocks, section) : -1), [parsed, section]);
  const [offsets, setOffsets] = useState<{ document?: number; body?: number; heading?: number }>({});
  const scrollTarget =
    anchorIndex >= 0 && offsets.document !== undefined && offsets.body !== undefined && offsets.heading !== undefined
      ? offsets.document + offsets.body + offsets.heading
      : null;
  const offset = (key: 'document' | 'body' | 'heading') => (y: number) => setOffsets((current) => (current[key] === y ? current : { ...current, [key]: y }));

  let body: ReactNode;
  if (qaState === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && !notFound && qaState !== 'error' && qaState !== 'empty')) {
    body = <DocumentSkeleton />;
  } else if (qaState === 'empty' || (notFound && !document)) {
    body = (
      <EmptyState
        icon="info"
        title={t('legal.notFoundTitle')}
        body={t('legal.notFoundBody')}
        action={{ label: t('legal.toList'), onPress: () => router.replace('/settings/legal'), variant: 'secondary', size: 'm' }}
        testID="SET-18.notFound"
      />
    );
  } else if (qaState === 'error' || !document || !parsed) {
    body = (
      <ErrorState
        title={online && query.fetchStatus !== 'paused' ? t('legal.documentErrorTitle') : t('legal.offlineTitle')}
        message={online && query.fetchStatus !== 'paused' ? undefined : t('legal.offlineBody')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID="SET-18.error"
      />
    );
  } else {
    body = (
      <View testID={`SET-18.document.${document.key}`} onLayout={(event) => offset('document')(event.nativeEvent.layout.y)}>
        <View style={styles.heading}>
          <Text
            variant="title1"
            role="heading"
            {...({ 'aria-level': 1 } as object)}
            // SettingsPage puts 8 above the content: the title is gone under the header after its height and those 8.
            onLayout={(event) => collapsing.collapseAt.set(event.nativeEvent.layout.height + space[8])}
            testID="SET-18.title"
          >
            {title}
          </Text>
          <Text variant="callout" color="text.secondary" testID="SET-18.meta">
            {meta(document)}
          </Text>
        </View>
        <View onLayout={(event) => offset('body')(event.nativeEvent.layout.y)}>
          <Markdown blocks={parsed.blocks} anchor={anchorIndex >= 0 ? { index: anchorIndex, onLayout: offset('heading') } : undefined} testID="SET-18.body" />
        </View>
      </View>
    );
  }

  return (
    <SettingsPage
      routeId="SET-18"
      title={title}
      collapsing={collapsing}
      fallback="/settings/legal"
      offlineLabel={t('legal.offlineCached')}
      focusableScroll
      section="legal"
      scrollTarget={scrollTarget}
    >
      {body}
    </SettingsPage>
  );
}
