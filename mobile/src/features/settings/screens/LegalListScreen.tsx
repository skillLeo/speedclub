import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useLegalDocuments, type LegalSummary } from '@/api/queries/legal';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, space } from '@/theme';
import { EmptyState, ErrorState, Hairline, ListRow, Skeleton, SkeletonText } from '@/ui';

import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { formatLegalDate } from '../legalDate';

const useStyles = createStyles((t) => ({
  skeletonCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { gap: t.space[4], justifyContent: 'center', minHeight: size.row.withThumb, paddingHorizontal: space[16] },
}));

/** "Version 1, gültig seit 6. November 2026", in the same words as the public page of the document (DQ-225, WEB-08). */
export function useLegalMeta() {
  const { t } = useTranslation('settings');
  const { locale } = useFormat();
  return (document: Pick<LegalSummary, 'version' | 'published_at'>) =>
    t('legal.meta', { version: document.version, date: formatLegalDate(new Date(document.published_at), locale) });
}

function ListSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID="SET-17.skeleton">
      <View style={styles.skeletonCard}>
        {Array.from({ length: 5 }, (_, index) => (
          <View key={index}>
            <View style={styles.skeletonRow}>
              <SkeletonText variant="body" width="45%" />
              <SkeletonText variant="supporting" width="35%" />
            </View>
            {index < 4 ? <Hairline inset={space[16]} /> : null}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** SET-17. Public, also during onboarding and for guests; offline it shows the list it read last. */
export function LegalListScreen() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const meta = useLegalMeta();
  const query = useLegalDocuments();
  const documents = qaState === 'empty' ? [] : query.data;

  let body: ReactNode;
  if (qaState === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'empty')) {
    body = <ListSkeleton />;
  } else if (qaState === 'error' || (!documents && (query.isError || query.fetchStatus === 'paused'))) {
    body = (
      <ErrorState
        title={online && query.fetchStatus !== 'paused' ? t('legal.listErrorTitle') : t('legal.offlineTitle')}
        message={online && query.fetchStatus !== 'paused' ? undefined : t('legal.offlineListBody')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID="SET-17.error"
      />
    );
  } else if (!documents || documents.length === 0) {
    body = <EmptyState icon="info" title={t('legal.emptyTitle')} body={t('legal.emptyBody')} testID="SET-17.empty" />;
  } else {
    body = (
      <RowGroup testID="SET-17.list">
        {documents.map((document, index) => (
          <ListRow
            key={document.key}
            title={document.title}
            subtitle={meta(document)}
            onPress={() => router.push({ pathname: '/settings/legal/[doc]', params: { doc: document.key } })}
            inset={space[16]}
            divider={index < documents.length - 1}
            testID={`SET-17.row.${document.key}`}
          />
        ))}
      </RowGroup>
    );
  }

  return (
    <SettingsPage
      routeId="SET-17"
      title={t('legal.title')}
      fallback="/settings"
      offlineLabel={t('legal.offlineBanner')}
      section="legal"
    >
      {body}
    </SettingsPage>
  );
}
