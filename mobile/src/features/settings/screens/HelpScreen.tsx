import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { EmptyState, ErrorState, Hairline, ListRow, Skeleton, SkeletonText } from '@/ui';

import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { SETTINGS_PATHS } from '../navigation';
import { useHelpArticles } from '@/api/queries/settings';

const ROUTE = 'SET-14';
const SKELETON_ROWS = 6;

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  skeletonRow: { justifyContent: 'center', minHeight: size.row.single, paddingHorizontal: ROW_INSET },
  skeletonCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

function HelpSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeletonCard}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index}>
            <View style={styles.skeletonRow}>
              <SkeletonText variant="body" width={index % 2 ? '55%' : '70%'} />
            </View>
            {index < SKELETON_ROWS - 1 ? <Hairline inset={ROW_INSET} /> : null}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** SET-14 /settings/help: the published articles in the app's language, and the way to support for members (SET-15). */
export function HelpScreen() {
  const { t, i18n } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const member = useSessionStore((state) => state.status === 'member');
  const locale = i18n.language === 'en' ? 'en' : 'de';
  const query = useHelpArticles(locale);
  const articles = qaState === 'empty' ? [] : query.data;

  let list: ReactNode;
  if (qaState === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'empty')) {
    list = <HelpSkeleton />;
  } else if (qaState === 'error' || (!articles && (query.isError || query.fetchStatus === 'paused'))) {
    const offline = !online || query.fetchStatus === 'paused';
    list = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('help.errorTitle')}
        message={offline ? t('help.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (!articles || articles.length === 0) {
    list = <EmptyState icon="question" title={t('help.emptyTitle')} body={t('help.emptyBody')} testID={`${ROUTE}.empty`} />;
  } else {
    list = (
      <RowGroup title={t('help.articlesGroup')} testID={`${ROUTE}.list`}>
        {articles.map((article, index) => (
          <ListRow
            key={article.key}
            title={article.title}
            onPress={() => router.push({ pathname: '/settings/help/[key]', params: { key: article.key } })}
            inset={ROW_INSET}
            divider={index < articles.length - 1}
            testID={`${ROUTE}.row.${article.key}`}
          />
        ))}
      </RowGroup>
    );
  }

  return (
    <SettingsPage routeId={ROUTE} title={t('help.title')} fallback="/settings" offlineLabel={t('help.offlineBanner')} section="help">
      <View style={styles.groups}>
        {list}
        {member ? (
          <RowGroup title={t('help.contactGroup')} testID={`${ROUTE}.contactGroup`}>
            <ListRow
              icon="chat-circle"
              title={t('rows.contact')}
              subtitle={t('help.contactHint')}
              onPress={() => router.push(SETTINGS_PATHS.contact)}
              inset={ROW_INSET}
              divider
              testID={`${ROUTE}.contact`}
            />
            {/* M3.5: the member's requests and the team's replies (SET-15a). */}
            <ListRow
              icon="lifebuoy"
              title={t('requests.row')}
              subtitle={t('requests.rowHint')}
              onPress={() => router.push('/settings/help/requests')}
              inset={ROW_INSET}
              testID={`${ROUTE}.requests`}
            />
          </RowGroup>
        ) : null}
      </View>
    </SettingsPage>
  );
}
