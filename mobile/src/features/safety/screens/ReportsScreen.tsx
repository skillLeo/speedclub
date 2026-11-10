import type { FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { FormNotice } from '@/features/auth/components/FormNotice';
import { SettingsSplit, useSettingsSplit } from '@/features/settings/components/SettingsSplit';
import { PushedListPage } from '@/features/shell/PushedListPage';
import { useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  CollapsingFlashList,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  type IconName,
} from '@/ui';

import { EmptyGroupRow, GroupCard, ReportRow } from '../components/ReportRow';
import { SafetySignIn, useAccountRestricted } from '../components/states';
import { isUnavailable, useSafety } from '../data';
import type { ReportTargetType } from '../model';
import { REPORTS_PATH } from '../ReportSheet';
import { targetLabel } from '../labels';
import { decisionOf, reportsItems, reportStatus, type ReportsItem, type ReportsSection } from '../reportsList';

const ROUTE = 'SET-16';

export const TARGET_GLYPHS: Readonly<Record<ReportTargetType, IconName>> = {
  member: 'user',
  vehicle: 'garage',
  photo: 'image',
  message: 'chat-circle',
  build_update: 'list',
  modification: 'wrench',
};

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  intro: { gap: t.space[16], marginBottom: t.space[8] },
  state: { paddingTop: t.space[32] },
  // FS-12 group labels (RowGroup): label.s secondary 16 inside the card's edge, 8 above the card, groups 32 apart.
  label: { marginBottom: t.space[8], paddingHorizontal: t.space[16] },
  labelMine: { marginTop: t.space[16] },
  labelAbout: { marginTop: t.space[32] },
  more: { marginTop: t.space[4], paddingHorizontal: t.space[16] },
}));

type RowProps = {
  item: ReportsItem;
  columnStyle: StyleProp<ViewStyle>;
  onOpen: (decisionId: string) => void;
  onMore: (section: ReportsSection) => void;
  loadingMore: (section: ReportsSection) => boolean;
};

const ReportsRow = memo(function ReportsRow({ item, columnStyle, onOpen, onMore, loadingMore }: RowProps) {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const format = useFormat();
  const decisionId = decisionOf(item);
  const open = decisionId ? () => onOpen(decisionId) : undefined;
  let content: ReactNode;
  switch (item.kind) {
    case 'header':
      content = (
        <Text
          variant="labelS"
          color="text.secondary"
          role="heading"
          {...({ 'aria-level': 2 } as object)}
          style={[styles.label, item.section === 'mine' ? styles.labelMine : styles.labelAbout]}
          testID={`${ROUTE}.section.${item.section}`}
        >
          {t(item.section === 'mine' ? 'reports.mine' : 'reports.about')}
        </Text>
      );
      break;
    case 'empty':
      content = (
        <GroupCard first last testID={`${ROUTE}.card.${item.key}`}>
          <EmptyGroupRow
            title={t(item.section === 'mine' ? 'reports.emptyMineTitle' : 'reports.emptyAboutTitle')}
            body={t(item.section === 'mine' ? 'reports.emptyMineBody' : 'reports.emptyAboutBody')}
            testID={`${ROUTE}.empty.${item.section}`}
          />
        </GroupCard>
      );
      break;
    case 'report':
      content = (
        <GroupCard first={item.first} last={item.last} testID={`${ROUTE}.card.${item.key}`}>
          <ReportRow
            icon={TARGET_GLYPHS[item.report.target.type]}
            title={targetLabel(t, item.report.target)}
            subtitle={t('reports.meta', {
              first: t(`report.reasons.${item.report.reason}`),
              date: item.report.decision?.appealStatus === 'open' ? t('reports.appealPending') : format.date(new Date(item.report.createdAt)),
            })}
            status={t(`status.${reportStatus(item.report)}`)}
            onPress={open}
            divider={!item.last}
            testID={`${ROUTE}.report.${item.report.id}`}
          />
        </GroupCard>
      );
      break;
    case 'decision':
      content = (
        <GroupCard first={item.first} last={item.last} testID={`${ROUTE}.card.${item.key}`}>
          <ReportRow
            icon={TARGET_GLYPHS[item.decision.target.type]}
            title={targetLabel(t, item.decision.target)}
            subtitle={t('reports.meta', {
              first: t(`actions.${item.decision.action}`),
              date:
                item.decision.appealStatus === 'open'
                  ? t('reports.appealPending')
                  : format.date(new Date(item.decision.decidedAt)),
            })}
            status={t('status.decided')}
            onPress={open}
            divider={!item.last}
            testID={`${ROUTE}.decision.${item.decision.id}`}
          />
        </GroupCard>
      );
      break;
    case 'more':
      content = (
        <View style={styles.more}>
          <Button
            label={t('reports.more')}
            variant="tertiary"
            size="m"
            flush="start"
            loading={loadingMore(item.section)}
            onPress={() => onMore(item.section)}
            testID={`${ROUTE}.more.${item.section}`}
          />
        </View>
      );
      break;
  }
  return <View style={columnStyle}>{content}</View>;
});

/**
 * DQ-422: the loaded page's geometry, never longer than it: each group's label and a card of one 72 row, the size of the first
 * report and of the empty row alike.
 */
function ReportsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {(['mine', 'about'] as const).map((section) => (
        <View key={section} testID={`${ROUTE}.skeleton.${section}`}>
          <SkeletonText variant="labelS" width="40%" style={[styles.label, section === 'mine' ? styles.labelMine : styles.labelAbout]} />
          <SkeletonBlock height={size.row.withThumb} corner="md" testID={`${ROUTE}.skeleton.${section}.card`} />
        </View>
      ))}
    </Skeleton>
  );
}

/**
 * SET-16 /settings/reports: "Meine Meldungen" with their status (Eingegangen, In Prüfung, Entschieden) and "Entscheidungen zu deinen
 * Inhalten"; every row with a decision opens SAFE-01. Each section is an FS-12 inset group with its own empty row (DQ-421).
 */
export function ReportsScreen() {
  const { t } = useTranslation('safety');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const back = useBack('/settings');
  const split = useSettingsSplit();
  const restricted = useAccountRestricted();
  const safety = useSafety();
  const reports = safety.useMyReports();
  const decisions = safety.useMyDecisions();
  const listRef = useRef<FlashListRef<ReportsItem>>(null);

  const items = useMemo(
    () =>
      qaState === 'empty'
        ? reportsItems([], [])
        : reportsItems(reports.data ?? [], decisions.data ?? [], { mine: reports.hasMore, about: decisions.hasMore }),
    [decisions.data, decisions.hasMore, qaState, reports.data, reports.hasMore],
  );
  const { loadMore: moreReports, isLoadingMore: reportsMore } = reports;
  const { loadMore: moreDecisions, isLoadingMore: decisionsMore } = decisions;
  const onMore = useCallback((section: ReportsSection) => (section === 'mine' ? moreReports() : moreDecisions()), [moreDecisions, moreReports]);
  const loadingMore = useCallback((section: ReportsSection) => (section === 'mine' ? reportsMore : decisionsMore), [decisionsMore, reportsMore]);
  const onOpen = useCallback((id: string) => router.push({ pathname: '/decision/[id]', params: { id } }), [router]);

  const loaded = reports.data !== undefined && decisions.data !== undefined;
  const failed = reports.error ?? decisions.error;
  let state: ReactNode = null;
  // DQ-276: a skeleton stands exactly where the groups will, without the gap that empty, error and offline get.
  let loading = false;
  if (status === 'guest') {
    state = <SafetySignIn routeId={ROUTE} returnTo={REPORTS_PATH} />;
  } else if (qaState === 'empty') {
    state = null;
  } else if (!safety.available || isUnavailable(failed)) {
    state = <EmptyState icon="flag" title={t('reports.soonTitle')} body={t('reports.soonBody')} testID={`${ROUTE}.soon`} />;
  } else if (
    qaState === 'loading' ||
    status === 'loading' ||
    (!loaded && (reports.isPending || decisions.isPending) && !reports.isPaused && !decisions.isPaused && !failed && qaState === 'default')
  ) {
    loading = true;
    state = <ReportsSkeleton />;
  } else if (qaState === 'error' || qaState === 'offline' || !loaded) {
    const offline = qaState === 'offline' || !online || reports.isPaused || decisions.isPaused;
    state = (
      <ErrorState
        title={offline ? t('reports.offlineTitle') : t('reports.errorTitle')}
        message={offline ? t('reports.offlineBody') : undefined}
        onRetry={() => {
          reports.refetch();
          decisions.refetch();
        }}
        retrying={reports.isFetching || decisions.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  }

  return (
    <SettingsSplit routeId={ROUTE} section="reports">
      <PushedListPage
        routeId={ROUTE}
        title={t('reports.title')}
        // DQ-420: the settings list stands beside this page from 1280; it is the way back there.
        onBack={split ? undefined : back}
        offlineLabel={t('reports.offlineBanner')}
        onScrollToTop={(animated) => listRef.current?.scrollToOffset({ offset: 0, animated })}
        renderList={(frame) => (
          <CollapsingFlashList
            ref={listRef}
            {...frame.scrollProps}
            data={state ? [] : items}
            keyExtractor={(item: ReportsItem) => item.key}
            getItemType={(item: ReportsItem) => item.kind}
            style={styles.list}
            contentContainerStyle={frame.contentContainerStyle}
            ListHeaderComponent={
              status === 'guest' ? null : (
                <View style={[frame.columnStyle, styles.intro]}>
                  <Text variant="bodyDense" color="text.secondary" testID={`${ROUTE}.intro`}>
                    {t('reports.intro')}
                  </Text>
                  {restricted ? <FormNotice tone="info" message={t('decision.restricted')} testID={`${ROUTE}.restricted`} /> : null}
                </View>
              )
            }
            ListEmptyComponent={
              state ? (
                <View style={[frame.columnStyle, loading ? null : styles.state]} testID={`${ROUTE}.state`}>
                  {state}
                </View>
              ) : null
            }
            ListFooterComponent={<View style={frame.endStyle} />}
            renderItem={({ item }: { item: ReportsItem }) => (
              <ReportsRow item={item} columnStyle={frame.columnStyle} onOpen={onOpen} onMore={onMore} loadingMore={loadingMore} />
            )}
            testID={`${ROUTE}.list`}
          />
        )}
      />
    </SettingsSplit>
  );
}
