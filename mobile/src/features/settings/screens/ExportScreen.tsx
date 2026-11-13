import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { ApiError } from '@/api/client';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { formatWait } from '@/features/auth/forms';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { ViewAsUnavailable } from '@/features/viewAs/ViewAsUnavailable';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Button, ErrorState, Hairline, Icon, Skeleton, SkeletonBlock, SkeletonText, StatusPill, Text, toast } from '@/ui';

import { ReauthSheet } from '../components/ReauthSheet';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { settingsKeys, useDataExports, useRequestExport, type DataExport } from '@/api/queries/settings';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-12';
/** What the ZIP holds (contract §3), in the order of the README. */
export const EXPORT_CONTENTS = ['profile', 'vehicles', 'social', 'messages', 'notifications', 'reports', 'photos'] as const;
const IN_PROGRESS = new Set<DataExport['status']>(['queued', 'running']);

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  list: { gap: t.space[12], padding: ROW_INSET },
  item: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  itemText: { flex: 1 },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[12],
    justifyContent: 'space-between',
    minHeight: t.size.row.withThumb,
    paddingHorizontal: ROW_INSET,
    paddingVertical: t.space[12],
  },
  statusText: { flexBasis: '55%', flexGrow: 1, gap: t.space[2] },
  skeletonList: { gap: t.space[12], padding: ROW_INSET },
}));

function ExportSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="body" lines={2} />
        <RowGroup>
          <View style={styles.skeletonList}>
            {EXPORT_CONTENTS.map((item) => (
              <SkeletonText key={item} variant="body" width="80%" />
            ))}
          </View>
        </RowGroup>
        <SkeletonBlock height={size.row.withThumb} corner="md" />
      </View>
    </Skeleton>
  );
}

function ExportRow({ item, divider }: { item: DataExport; divider: boolean }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const format = useFormat();
  const megabytes = (bytes: number) => format.number(bytes / 1_000_000, { maxFractionDigits: 1 });
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso)) : '');
  const detail =
    item.status === 'ready' && item.expiresAt
      ? t('export.readyUntil', { date: when(item.expiresAt) })
      : item.status === 'expired'
        ? t('export.expiredDetail')
        : item.status === 'failed'
          ? t('export.failedDetail')
          : t('export.workingDetail');
  return (
    <View>
      <View style={styles.statusRow} testID={`${ROUTE}.export.${item.id}`}>
        <View style={styles.statusText}>
          <Text variant="body">{t('export.requestedAt', { date: when(item.requestedAt) })}</Text>
          <Text variant="callout" color="text.secondary">
            {detail}
          </Text>
        </View>
        <StatusPill label={t(`export.status.${item.status}`)} testID={`${ROUTE}.export.${item.id}.status`} />
        {item.status === 'ready' && item.downloadUrl ? (
          // The signed link of the mail: it works without a session, in the browser as in the app (handover §7.1).
          <Button
            label={t('export.download')}
            variant="secondary"
            size="m"
            icon="download-simple"
            role="link"
            onPress={() => void Linking.openURL(item.downloadUrl ?? '')}
            accessibilityLabel={item.bytes ? t('export.downloadSized', { size: megabytes(item.bytes) }) : undefined}
            testID={`${ROUTE}.export.${item.id}.download`}
          />
        ) : null}
      </View>
      {divider ? <Hairline inset={ROW_INSET} /> : null}
    </View>
  );
}

/**
 * SET-12 /settings/data/export: what the ZIP holds, then the password, then the status of every export. The ZIP is built in the
 * background and a link arrives by e-mail, valid 7 days; one export per 24 hours (§3.1, 08 §1).
 */
export function ExportScreen() {
  const { t } = useTranslation('settings');
  const { t: authT } = useTranslation('auth');
  const styles = useStyles();
  const client = useQueryClient();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  // View-as (ADR-227): the export holds the member's messages, so neither its list nor a request is offered.
  const viewAs = useViewAsReadOnly();
  const query = useDataExports();
  const request = useRequestExport();
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** POST me/export answered 503: exports are paused for a while; "Erneut versuchen" asks for the password again. */
  const [unavailable, setUnavailable] = useState<{ retryAfter: number | null } | null>(null);
  const exports = qaState === 'empty' ? [] : (query.data ?? []);
  const running = exports.some((item) => IN_PROGRESS.has(item.status));

  const confirm = async ({ password, code }: { password: string; code?: string }) => {
    try {
      await request.mutateAsync({ password, ...(code ? { code } : {}) });
      setAsking(false);
      setNotice(null);
      setUnavailable(null);
      toast(t('export.requested'), { haptic: 'success', testID: `${ROUTE}.requested` });
      void client.invalidateQueries({ queryKey: settingsKeys.exports });
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'rate_limited') {
        setAsking(false);
        setNotice(error.retryAfter ? t('export.tooSoonIn', { time: formatWait(authT, error.retryAfter) }) : t('export.tooSoon'));
        return;
      }
      // Handover §26: the export disk is full for now. The request can simply be sent again later.
      if (error instanceof ApiError && error.status === 503) {
        setAsking(false);
        setNotice(null);
        setUnavailable({ retryAfter: error.retryAfter });
        return;
      }
      throw error;
    }
  };

  let statusBlock: ReactNode;
  if (qaState === 'loading' || (query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'empty')) {
    statusBlock = <SkeletonBlock height={size.row.withThumb} corner="md" />;
  } else if (qaState === 'error' || (!query.data && qaState !== 'empty')) {
    const offline = !online || query.fetchStatus === 'paused';
    statusBlock = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('export.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (exports.length === 0) {
    statusBlock = (
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.empty`}>
        {t('export.none')}
      </Text>
    );
  } else {
    statusBlock = (
      <RowGroup title={t('export.statusGroup')} testID={`${ROUTE}.exports`}>
        {exports.map((item, index) => (
          <ExportRow key={item.id} item={item} divider={index < exports.length - 1} />
        ))}
      </RowGroup>
    );
  }

  let body: ReactNode;
  if (viewAs) {
    body = <ViewAsUnavailable kind="export" testID={`${ROUTE}.viewAs`} />;
  } else if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/data/export" />;
  } else if (status === 'loading' || qaState === 'loading') {
    body = <ExportSkeleton />;
  } else {
    body = (
      <View style={styles.body}>
        <RestrictionNotice routeId={ROUTE} />
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('export.intro')}
        </Text>
        <RowGroup title={t('export.contentsGroup')} testID={`${ROUTE}.contents`}>
          <View style={styles.list}>
            {EXPORT_CONTENTS.map((item) => (
              <View key={item} style={styles.item} testID={`${ROUTE}.contents.${item}`}>
                <Icon name="check" size={20} color="text.secondary" />
                <Text variant="body" style={styles.itemText}>
                  {t(`export.contents.${item}`)}
                </Text>
              </View>
            ))}
          </View>
        </RowGroup>
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.notIncluded`}>
          {t('export.notIncluded')}
        </Text>
        {notice ? <FormNotice message={notice} tone="info" testID={`${ROUTE}.notice`} /> : null}
        {unavailable ? (
          <ErrorState
            title={t('export.unavailableTitle')}
            message={
              unavailable.retryAfter
                ? t('export.unavailableBodyIn', { time: formatWait(authT, unavailable.retryAfter) })
                : t('export.unavailableBody')
            }
            onRetry={() => {
              setUnavailable(null);
              setAsking(true);
            }}
            testID={`${ROUTE}.unavailable`}
          />
        ) : null}
        {statusBlock}
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.retention`}>
          {t('export.retentionNote')}
        </Text>
      </View>
    );
  }

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('export.title')}
      fallback="/settings"
      offlineLabel={t('export.offlineBanner')}
      section="export"
      form={
        status === 'member' && !viewAs
          ? {
              dirty: false,
              cta: { label: t(running ? 'export.running' : 'export.request'), onPress: () => setAsking(true), disabled: running || !online },
            }
          : undefined
      }
      overlays={
        <ReauthSheet
          visible={asking}
          onClose={() => setAsking(false)}
          title={t('export.reauthTitle')}
          body={t('export.reauthBody')}
          confirmLabel={t('export.reauthConfirm')}
          onConfirm={confirm}
          testID={`${ROUTE}.reauth`}
        />
      }
    >
      {body}
    </SettingsPage>
  );
}
