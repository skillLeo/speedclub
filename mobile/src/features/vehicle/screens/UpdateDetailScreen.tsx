import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { canEditUpdate, useBuildUpdate, useDeleteBuildUpdate } from '@/api/queries/social2';
import {
  isEntryNotFound,
  useCachedPublicVehicle,
  usePublicUpdate,
  usePublicVehicle,
  type BuildUpdate,
} from '@/api/queries/vehicles';
import { useReport } from '@/features/safety/useReport';
import { CommentsSection } from '@/features/updates/components/Comments';
import { MentionText } from '@/features/updates/components/MentionText';
import { OwnerReactions, ReactButton, useBuildReactions } from '@/features/updates/components/Reactions';
import { unpairedPhotos, updatePairs } from '@/features/updates/model';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';
import { createStyles, space, useBreakpoint } from '@/theme';
import {
  Dialog,
  ListRow,
  Photo,
  SectionHeader,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  SpecRow,
  Text,
  toast,
} from '@/ui';
import { BeforeAfter } from '@/ui/motion/kit';
import { TranslatableText } from '@/features/ai/TranslatableText';

import { photoFields } from '../media';
import { updateHeadline } from '../model';

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
  changeTop: { height: t.space[4] },
  text: { paddingBottom: t.space[12], paddingHorizontal: t.space[16] },
  skeletonCard: { marginTop: t.space[32] },
  vehicle: { marginBottom: t.space[16] },
  media: { gap: t.space[8], marginTop: t.space[20] },
  // DQ-1054: an update without photos of its own shows the car's photo as a 16:9 band, labelled where it comes from.
  fallback: { gap: t.space[8], marginTop: t.space[20] },
  photo: { overflow: 'hidden' },
  react: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], marginTop: t.space[24] },
}));

/** Photos in the content column are as wide as the column (PushedPage keeps the gutter). */
const MEDIA_WIDTH_FALLBACK = 390;

type Change = BuildUpdate['changes'][number];

/** One change: its label, then before and after as a two-row table, then the fields of a changed mod. */
function ChangeCard({
  change,
  index,
  fallbackLabel,
  hideLabel = false,
  onOpenMod,
}: {
  change: Change;
  index: number;
  fallbackLabel: string;
  hideLabel?: boolean;
  onOpenMod?: () => void;
}) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const rows = [
    change.before !== null || change.after !== null
      ? { key: 'before', label: t('update.before'), value: change.before ?? NOT_SET }
      : null,
    change.before !== null || change.after !== null
      ? { key: 'after', label: t('update.after'), value: change.after ?? NOT_SET }
      : null,
    ...change.details.map((detail, position) => ({
      key: `detail-${position}`,
      label: detail.label,
      value: `${detail.before ?? NOT_SET} → ${detail.after ?? NOT_SET}`,
    })),
  ].filter((row): row is { key: string; label: string; value: string } => row !== null);
  const label = change.label.trim() || fallbackLabel;

  return (
    <RowCard style={index === 0 ? styles.changeFirst : styles.change} testID={`${ROUTE_ID}.change.${index}`}>
      {hideLabel ? <View style={styles.changeTop} /> : (
        <Text variant="bodyStrong" style={styles.changeLabel}>
          {label}
        </Text>
      )}
      {rows.length === 0 && change.text ? (
        <Text variant="callout" color="text.secondary" style={styles.text}>
          {change.text}
        </Text>
      ) : null}
      {rows.map((row, position) => (
        <SpecRow
          key={row.key}
          label={row.label}
          value={row.value}
          divider={position < rows.length - 1 || Boolean(onOpenMod)}
          inset={space[16]}
        />
      ))}
      {onOpenMod ? (
        <ListRow
          icon="wrench"
          title={t('update.openMod')}
          onPress={onOpenMod}
          inset={space[16]}
          testID={`${ROUTE_ID}.openMod.${index}`}
        />
      ) : null}
    </RowCard>
  );
}

function ChangesSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE_ID}.skeleton`} style={styles.skeletonCard}>
      <SkeletonText variant="headline" width="30%" style={styles.headerToContent} />
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
  const buildReactions = useBuildReactions();
  const params = useLocalSearchParams<{ slug: string; updateId: string }>();
  const slug = paramOf(params.slug) ?? '';
  const updateId = paramOf(params.updateId) ?? '';
  const vehiclePath = `/v/${slug}` as const;
  const back = useBack(vehiclePath);
  const publicQuery = usePublicUpdate(slug, updateId);
  // A followers-only post is not on the public route (404); a member who may see it reads it from build-updates/{id}.
  const member = useSessionStore((session) => session.status === 'member');
  const fallback = useBuildUpdate(member && isEntryNotFound(publicQuery.error) ? updateId : undefined);
  const query = fallback.data || fallback.isFetching ? fallback : publicQuery;
  const state = useRouteState(query);
  const { width, gutter } = useBreakpoint();
  const mediaWidth = Math.min(width, 768) - 2 * gutter || MEDIA_WIDTH_FALLBACK;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removal = useDeleteBuildUpdate(updateId, slug);
  const cached = useCachedPublicVehicle(slug)?.updates.find((update) => update.id === updateId);
  const update = state === 'ready' ? query.data : state === 'loading' ? cached : undefined;
  // M2.6: "Melden" for an update of someone else's build; the build page gives the owner and the title.
  const vehicle = usePublicVehicle(slug).data;
  const owner = vehicle?.owner?.username ?? undefined;
  const report = useReport(
    {
      type: 'build_update',
      id: updateId,
      label: t('update.reportLabel', { vehicle: vehicle?.full_title ?? '' }),
      ...(owner ? { owner } : {}),
    },
    { routeId: ROUTE_ID, onBlocked: () => router.replace('/') },
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const own = vehicle !== undefined && (vehicle.is_owner || Boolean(vehicle.owner?.is_self));
  const reportable = report.available && vehicle !== undefined && !own;

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

  const created = update?.happened_on
    ? new Date(`${update.happened_on}T12:00:00`)
    : update?.created_at
      ? new Date(update.created_at)
      : null;
  // DQ-1059: the kind once. The title names the change ("AP Racing Radi-CAL statt Brembo Serie"), the meta its system and date.
  const head = update ? updateHeadline(update, (key, values) => t(`history.title.${key}`, values)) : null;
  const meta = update
    ? [
        head?.system ?? null,
        created ? format.date(created) : null,
        update.mileage_km !== null ? t('update.mileage', { value: format.number(update.mileage_km) }) : null,
        update.audience === 'followers' ? t('update.audienceFollowers') : null,
        update.edited_at ? t('update.edited') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const pairs = update ? updatePairs(update) : [];
  const singles = update ? unpairedPhotos(update) : [];
  const editable = own && update !== undefined && canEditUpdate(update);
  const moreActions = [
    ...(reportable
      ? [{ key: 'report', icon: 'flag' as const, label: report.label, onPress: report.open }]
      : []),
    ...(own && update && editable
      ? [
          {
            key: 'edit',
            icon: 'pencil-simple' as const,
            label: t('update.edit'),
            onPress: () => router.push({ pathname: '/post-update', params: { updateId: update.id, slug } }),
          },
        ]
      : []),
    ...(own && update
      ? [
          {
            key: 'delete',
            icon: 'trash' as const,
            label: t('update.delete'),
            onPress: () => setConfirmDelete(true),
          },
        ]
      : []),
  ];
  const headline = head?.title ?? '';
  const fallbackPhoto = vehicle?.cover ?? null;
  const reactionLabel = update?.my_reaction ? (buildReactions.find((reaction) => reaction.key === update.my_reaction)?.label ?? t('reactions.react')) : t('reactions.react');
  const changes = state === 'ready' ? (update?.changes ?? []) : [];
  const note = update?.note?.trim();

  return (
    <PushedPage
      routeId={ROUTE_ID}
      title={t('update.screenTitle')}
      onBack={back}
      actions={
        moreActions.length > 0 && update
          ? [
              {
                icon: 'dots-three',
                label: t('actions.more'),
                onPress: () => setMoreOpen(true),
                testID: `${ROUTE_ID}.more`,
              },
            ]
          : undefined
      }
      overlays={
        <>
          <MoreSheet
            visible={moreOpen}
            onClose={() => setMoreOpen(false)}
            title={t('update.screenTitle')}
            actions={moreActions}
            testID={`${ROUTE_ID}.moreSheet`}
          />
          <Dialog
            visible={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            title={t('update.deleteTitle')}
            body={t('update.deleteBody')}
            actions={[
              {
                label: t('update.cancel'),
                variant: 'secondary',
                onPress: () => setConfirmDelete(false),
                testID: `${ROUTE_ID}.delete.cancel`,
              },
              {
                label: t('update.deleteConfirm'),
                destructive: true,
                onPress: () =>
                  removal.mutate(undefined, {
                    onSuccess: () => {
                      setConfirmDelete(false);
                      toast(t('update.deleted'), { testID: `${ROUTE_ID}.toast` });
                      router.replace(vehiclePath);
                    },
                    onError: (error) =>
                      toast(error.message || t('update.deleteFailed'), {
                        haptic: 'warning',
                        testID: `${ROUTE_ID}.toast`,
                      }),
                  }),
                loading: removal.isPending,
                testID: `${ROUTE_ID}.delete.confirm`,
              },
            ]}
            testID={`${ROUTE_ID}.delete`}
          />
          {report.element}
        </>
      }
    >
      {vehicle ? (
        <ListRow
          title={vehicle.title}
          subtitle={vehicle.owner ? `@${vehicle.owner.username}` : undefined}
          thumb={photoFields(vehicle.cover, space[48])}
          role="link"
          onPress={() => router.navigate(vehiclePath)}
          inset={0}
          style={styles.vehicle}
          testID={`${ROUTE_ID}.vehicle`}
        />
      ) : null}
      {update ? (
        <View>
          <Text variant="callout" color="text.secondary" testID={`${ROUTE_ID}.meta`}>
            {meta}
          </Text>
          <Text
            variant="title2"
            role="heading"
            {...({ 'aria-level': 1 } as object)}
            style={styles.title}
            testID={`${ROUTE_ID}.title`}
          >
            {headline}
          </Text>
          {pairs.length > 0 || singles.length > 0 ? (
            <View style={styles.media} testID={`${ROUTE_ID}.media`}>
              {pairs.map((pair, index) => (
                <BeforeAfter
                  key={`${pair.before.id}-${pair.after.id}`}
                  before={{ ...photoFields(pair.before, mediaWidth), label: t('update.before') }}
                  after={{ ...photoFields(pair.after, mediaWidth), label: t('update.after') }}
                  aspect="4:5"
                  label={t('update.beforeAfter')}
                  testID={`${ROUTE_ID}.beforeAfter.${index}`}
                />
              ))}
              {singles.map((photo, index) => (
                <View key={photo.id} style={styles.photo}>
                  <Photo
                    {...photoFields(photo, mediaWidth)}
                    aspect="4:5"
                    corner="md"
                    label={photo.alt || vehicle?.full_title}
                    testID={`${ROUTE_ID}.photo.${index}`}
                  />
                </View>
              ))}
            </View>
          ) : fallbackPhoto ? (
            <View style={styles.fallback} testID={`${ROUTE_ID}.fallbackPhoto`}>
              <Photo {...photoFields(fallbackPhoto, mediaWidth)} aspect="16:9" corner="md" label={vehicle?.full_title} />
              <Text variant="caption" color="text.secondary">
                {t('update.galleryPhoto')}
              </Text>
            </View>
          ) : null}
          {note ? (
            <View style={styles.note}>
              {/* M3.7 ai.translate: "Übersetzen" under another member's note while the flag is on. Mentions stay links. */}
              {own ? (
                <MentionText
                  text={note}
                  usernames={update.mentions.map((entry) => entry.username)}
                  testID={`${ROUTE_ID}.note`}
                />
              ) : (
                <TranslatableText
                  source="build_update"
                  id={update.id}
                  text={note}
                  render={(shown) => (
                    <MentionText
                      text={shown}
                      usernames={update.mentions.map((entry) => entry.username)}
                      testID={`${ROUTE_ID}.note`}
                    />
                  )}
                  testID={`${ROUTE_ID}.note`}
                />
              )}
            </View>
          ) : null}
        </View>
      ) : (
        <Skeleton testID={`${ROUTE_ID}.headerSkeleton`}>
          <SkeletonText variant="callout" width="45%" />
          <SkeletonText variant="title2" width="60%" style={styles.title} />
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
              // DQ-1059: one change under a title that already names it needs no system header of its own.
              hideLabel={changes.length === 1 && Boolean(head?.namesChange)}
              onOpenMod={
                change.modification_id && OPENS_MOD.has(change.kind)
                  ? () => router.push(`/v/${slug}/mods/${change.modification_id}`)
                  : undefined
              }
            />
          ))}
        </View>
      ) : null}
      {state === 'ready' && update && update.modifications.length > 0 ? (
        <View style={styles.section} testID={`${ROUTE_ID}.mods`}>
          <SectionHeader title={t('update.linkedMods')} style={styles.headerToContent} />
          <RowCard>
            {update.modifications.map((mod, index) => (
              <ListRow
                key={mod.id}
                icon="wrench"
                title={mod.title}
                role="link"
                onPress={() => router.push(`/v/${slug}/mods/${mod.id}`)}
                inset={space[16]}
                divider={index < update.modifications.length - 1}
                testID={`${ROUTE_ID}.mod.${mod.id}`}
              />
            ))}
          </RowCard>
        </View>
      ) : null}
      {state === 'ready' && update?.reaction_summary ? (
        <View style={styles.section}>
          <SectionHeader title={t('reactions.ownerTitle')} style={styles.headerToContent} />
          <OwnerReactions
            target="build-updates"
            id={update.id}
            summary={update.reaction_summary}
            testID={`${ROUTE_ID}.reactions`}
          />
        </View>
      ) : state === 'ready' && update && !own ? (
        <View style={styles.react}>
          <ReactButton
            target="build-updates"
            id={update.id}
            mine={update.my_reaction}
            testID={`${ROUTE_ID}.react`}
          />
          {/* DQ-1054 (c): the trigger says what it does, or which reaction is yours. The trigger names itself for readers. */}
          <Text variant="callout" color="text.secondary" aria-hidden testID={`${ROUTE_ID}.react.label`}>
            {reactionLabel}
          </Text>
        </View>
      ) : null}
      {state === 'ready' && update ? (
        <View style={styles.section}>
          <CommentsSection
            updateId={update.id}
            enabledByOwner={vehicle?.social?.comments_enabled !== false}
            onReport={report.openFor}
            reportable={report.available && !own}
            testID={`${ROUTE_ID}.comments`}
          />
        </View>
      ) : null}
    </PushedPage>
  );
}
