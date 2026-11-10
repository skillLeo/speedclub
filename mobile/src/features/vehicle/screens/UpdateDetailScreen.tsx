import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCachedPublicVehicle, usePublicUpdate, usePublicVehicle, type BuildUpdate } from '@/api/queries/vehicles';
import { useReport } from '@/features/safety/useReport';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { ListRow, Skeleton, SkeletonBlock, SkeletonText, SpecRow, Text } from '@/ui';
import { TranslatableText } from '@/features/ai/TranslatableText';

import { MoreSheet } from '../components/MoreSheet';
import { PushedPage } from '../components/PushedPage';
import { GroupHeader, RowCard } from '../components/RowCard';
import { StateScreen } from '../components/StateScreen';
import { paramOf, useBack } from '../navigation';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-05';
/** A change that names a mod can open it; a removed one is gone (VEH-02 would answer not found). */
const OPENS_MOD = new Set(['mod_added', 'mod_changed']);
const NOT_SET = '–';
const SKELETON_ROWS = 2;

const useStyles = createStyles((t) => ({
  title: { marginTop: t.space[4] },
  note: { marginTop: t.space[16] },
  section: { marginTop: t.space[32] },
  headerToContent: { marginBottom: t.space[12] },
  change: { marginTop: t.space[16] },
  changeFirst: { marginTop: 0 },
  changeLabel: { paddingBottom: t.space[4], paddingHorizontal: t.space[16], paddingTop: t.space[12] },
  text: { paddingBottom: t.space[12], paddingHorizontal: t.space[16] },
  skeletonCard: { marginTop: t.space[32] },
}));

type Change = BuildUpdate['changes'][number];

/** One change: its label, then before and after as a two-row table, then the fields of a changed mod. */
function ChangeCard({ change, index, fallbackLabel, onOpenMod }: { change: Change; index: number; fallbackLabel: string; onOpenMod?: () => void }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const rows = [
    change.before !== null || change.after !== null ? { key: 'before', label: t('update.before'), value: change.before ?? NOT_SET } : null,
    change.before !== null || change.after !== null ? { key: 'after', label: t('update.after'), value: change.after ?? NOT_SET } : null,
    ...change.details.map((detail, position) => ({
      key: `detail-${position}`,
      label: detail.label,
      value: `${detail.before ?? NOT_SET} → ${detail.after ?? NOT_SET}`,
    })),
  ].filter((row): row is { key: string; label: string; value: string } => row !== null);
  const label = change.label.trim() || fallbackLabel;

  return (
    <RowCard style={index === 0 ? styles.changeFirst : styles.change} testID={`${ROUTE_ID}.change.${index}`}>
      <Text variant="bodyStrong" style={styles.changeLabel}>
        {label}
      </Text>
      {rows.length === 0 && change.text ? (
        <Text variant="supporting" color="text.secondary" style={styles.text}>
          {change.text}
        </Text>
      ) : null}
      {rows.map((row, position) => (
        <SpecRow key={row.key} label={row.label} value={row.value} divider={position < rows.length - 1 || Boolean(onOpenMod)} inset={space[16]} />
      ))}
      {onOpenMod ? (
        <ListRow icon="wrench" title={t('update.openMod')} onPress={onOpenMod} inset={space[16]} testID={`${ROUTE_ID}.openMod.${index}`} />
      ) : null}
    </RowCard>
  );
}

function ChangesSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE_ID}.skeleton`} style={styles.skeletonCard}>
      <SkeletonText variant="titleS" width="30%" style={styles.headerToContent} />
      <SkeletonBlock width="100%" height={SKELETON_ROWS * space[48] + space[48]} corner="md" />
    </Skeleton>
  );
}

/** VEH-05 /v/[slug]/updates/[updateId]: one entry of Verlauf with every change, before → after, and its mod fields. */
export function UpdateDetailScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const params = useLocalSearchParams<{ slug: string; updateId: string }>();
  const slug = paramOf(params.slug) ?? '';
  const updateId = paramOf(params.updateId) ?? '';
  const vehiclePath = `/v/${slug}` as const;
  const back = useBack(vehiclePath);
  const query = usePublicUpdate(slug, updateId);
  const state = useRouteState(query);
  const cached = useCachedPublicVehicle(slug)?.updates.find((update) => update.id === updateId);
  const update = state === 'ready' ? query.data : state === 'loading' ? cached : undefined;
  // M2.6: "Melden" for an update of someone else's build; the build page gives the owner and the title.
  const vehicle = usePublicVehicle(slug).data;
  const owner = vehicle?.owner?.username ?? undefined;
  const report = useReport(
    { type: 'build_update', id: updateId, label: t('update.reportLabel', { vehicle: vehicle?.full_title ?? '' }), ...(owner ? { owner } : {}) },
    { routeId: ROUTE_ID, onBlocked: () => router.replace('/') },
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const reportable = report.available && vehicle !== undefined && !vehicle.is_owner && !vehicle.owner?.is_self;

  if (state !== 'ready' && state !== 'loading') {
    return (
      <StateScreen routeId={ROUTE_ID} title={t('update.screenTitle')} onBack={back}>
        <RouteStateBody
          state={state}
          routeId={ROUTE_ID}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          notFound={{
            title: t('update.notFoundTitle'),
            body: t('update.notFoundBody'),
            actionLabel: t('backToVehicle'),
            onAction: () => router.replace(vehiclePath),
          }}
        />
      </StateScreen>
    );
  }

  const created = update?.created_at ? new Date(update.created_at) : null;
  const meta = update ? [update.type_label, created ? format.date(created) : null].filter(Boolean).join(' · ') : '';
  const headline = update ? update.changes[0]?.label.trim() || update.type_label : '';
  const changes = state === 'ready' ? (update?.changes ?? []) : [];
  const note = update?.note?.trim();

  return (
    <PushedPage
      routeId={ROUTE_ID}
      title={t('update.screenTitle')}
      onBack={back}
      actions={
        reportable && update
          ? [{ icon: 'dots-three', label: t('actions.more'), onPress: () => setMoreOpen(true), testID: `${ROUTE_ID}.more` }]
          : undefined
      }
      overlays={
        <>
          <MoreSheet
            visible={moreOpen}
            onClose={() => setMoreOpen(false)}
            title={t('update.screenTitle')}
            actions={[{ key: 'report', icon: 'flag', label: report.label, onPress: report.open }]}
            testID={`${ROUTE_ID}.moreSheet`}
          />
          {report.element}
        </>
      }
    >
      {update ? (
        <View>
          <Text variant="supporting" color="text.secondary" testID={`${ROUTE_ID}.meta`}>
            {meta}
          </Text>
          <Text variant="titleM" role="heading" {...({ 'aria-level': 1 } as object)} style={styles.title} testID={`${ROUTE_ID}.title`}>
            {headline}
          </Text>
          {note ? (
            <View style={styles.note}>
              {/* M3.7 ai.translate: "Übersetzen" under another member's note while the flag is on. */}
              {vehicle?.is_owner || vehicle?.owner?.is_self ? (
                <Text variant="body" testID={`${ROUTE_ID}.note`}>
                  {note}
                </Text>
              ) : (
                <TranslatableText source="build_update" id={update.id} text={note} testID={`${ROUTE_ID}.note`} />
              )}
            </View>
          ) : null}
        </View>
      ) : (
        <Skeleton testID={`${ROUTE_ID}.headerSkeleton`}>
          <SkeletonText variant="supporting" width="45%" />
          <SkeletonText variant="titleM" width="60%" style={styles.title} />
        </Skeleton>
      )}
      {state === 'loading' ? <ChangesSkeleton /> : null}
      {changes.length > 0 ? (
        <View style={styles.section} testID={`${ROUTE_ID}.changes`}>
          <GroupHeader
            title={t('update.changes')}
            count={changes.length > 1 ? changes.length : undefined}
            style={styles.headerToContent}
          />
          {changes.map((change, index) => (
            <ChangeCard
              key={`${change.modification_id ?? change.kind}-${index}`}
              change={change}
              index={index}
              fallbackLabel={update?.type_label ?? ''}
              onOpenMod={
                change.modification_id && OPENS_MOD.has(change.kind)
                  ? () => router.push(`/v/${slug}/mods/${change.modification_id}`)
                  : undefined
              }
            />
          ))}
        </View>
      ) : null}
    </PushedPage>
  );
}
