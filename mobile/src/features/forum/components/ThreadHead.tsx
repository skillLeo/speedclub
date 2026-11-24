import { useRouter, type Href } from 'expo-router';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ForumPostSort, ForumThread } from '@/api/queries/forum';
import { DecisionLink } from '@/features/safety/components/DecisionLink';
import { REPORTS_PATH } from '@/features/safety/ReportSheet';
import { photoFields } from '@/features/profile/media';
import { variantUrl } from '@/features/vehicle/media';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { SampleBadges } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { ListRow } from '@/ui/ListRow';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { RowGroup } from '@/ui/RowGroup';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { ForumContent } from './ForumContent';
import { ForumTag, SolvedBadge } from './ForumBadges';
import { ThreadSummary } from './ThreadSummary';
import { categoryHref, threadPath } from '../navigation';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[24], paddingBottom: t.space[16] },
  lead: { overflow: 'hidden' },
  leadInset: { borderRadius: t.radius.xl },
  tags: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[8] },
  heading: { gap: t.space[16] },
  skeletonTags: { justifyContent: 'center', minHeight: t.size.statusPill },
  author: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  authorText: { flex: 1, gap: t.space[2], minWidth: 0 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  photo: { borderRadius: t.radius.sm, overflow: 'hidden' },
  notices: { gap: t.space[8] },
  solution: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  solutionHead: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  repliesHead: { gap: t.space[12] },
  tagList: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
}));

export type ThreadHeadProps = {
  thread: ForumThread;
  routeId: string;
  /** The column's width (photos take their variant from it); `leadBleed` lets the lead photo run edge to edge (phones). */
  width: number;
  leadBleed: number;
  sort: ForumPostSort;
  onSort: (sort: ForumPostSort) => void;
  onOpenPhoto: (index: number) => void;
  onOpenMember: (username: string) => void;
  onShowSolution: (postId: string) => void;
  /** `?post=` of the link that opened the thread: a merged thread hands it on to its target (the replies moved there). */
  focusPost?: string | null;
};

const PHOTO_COLUMNS = 3;

/**
 * FOR-03's opening (10 §7.2 ★): the lead photo edge to edge on phones (radius 20 inset from 768), the author's notices (In Prüfung,
 * nicht freigegeben, entfernt, zusammengeführt) and the reader's (geschlossen), the category and the tags, the title (title.1, Inter:
 * people speak Inter), the author, the opening post, the other photos, what is attached (car, mod, part), the solution, then the
 * replies' heading with their sort Chronologisch · Hilfreichste.
 */
export function ThreadHead({ thread, routeId, width, leadBleed, sort, onSort, onOpenPhoto, onOpenMember, onShowSolution, focusPost = null }: ThreadHeadProps) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const [lead, ...rest] = thread.photos.filter((photo) => photo.variants.length > 0);
  const author = thread.author;
  const name = author ? author.display_name || `@${author.username}` : t('post.someone');
  const created = thread.published_at ?? thread.created_at;
  const tile = Math.floor((width - (PHOTO_COLUMNS - 1) * space[8]) / PHOTO_COLUMNS);
  const own = thread.viewer.is_author;
  const merged = thread.status === 'merged' ? thread.merged_into : null;
  const solution = thread.solution;

  // DQ-P5-028: drawn only when it holds a notice; an empty view still took the column's 24 gap (the tag row sat 24 low against
  // its skeleton).
  const hasNotice =
    (own && (thread.status === 'pending' || thread.status === 'rejected' || thread.status === 'removed')) ||
    (thread.status === 'merged' && thread.merged_into !== null) ||
    (thread.is_locked && thread.status !== 'published');
  const notices = !hasNotice ? null : (
    <View style={styles.notices}>
      {own && thread.status === 'pending' ? <FormNotice tone="info" message={`${t('thread.pendingTitle')}: ${t('thread.pendingBody')}`} testID={`${routeId}.pending`} /> : null}
      {own && thread.status === 'rejected' ? (
        <FormNotice
          tone="info"
          message={[t('thread.rejectedBody'), thread.review_reason ? t('thread.rejectedReason', { reason: thread.review_reason }) : null].filter(Boolean).join(' ')}
          testID={`${routeId}.rejected`}
        />
      ) : null}
      {own && thread.status === 'removed' ? (
        <View>
          <FormNotice tone="info" message={t('thread.removedBody')} testID={`${routeId}.removed`} />
          <Button label={t('thread.removedLink')} variant="tertiary" size="m" role="link" flush="start" onPress={() => router.push(REPORTS_PATH as Href)} testID={`${routeId}.removed.link`} />
        </View>
      ) : null}
      {merged ? (
        <View>
          <FormNotice tone="info" message={t('thread.mergedBody', { title: merged.title })} testID={`${routeId}.merged`} />
          <Button
            label={t('thread.mergedLink')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={() => router.replace(threadPath(merged.id, focusPost))}
            testID={`${routeId}.merged.link`}
          />
        </View>
      ) : null}
      {/* A locked thread says so once, in the reply bar at the foot (DQ-P5-037 b); only a locked thread that is not published (no bar)
          says it here. */}
      {thread.is_locked && thread.status !== 'published' ? <FormNotice tone="info" message={t('thread.locked')} testID={`${routeId}.locked`} /> : null}
    </View>
  );

  return (
    <View style={styles.root} testID={`${routeId}.head`}>
      {lead ? (
        <PressableScale
          role="button"
          aria-label={t('thread.photo', { index: 1, count: thread.photos.length })}
          onPress={() => onOpenPhoto(0)}
          style={[styles.lead, leadBleed > 0 ? { marginHorizontal: -leadBleed } : styles.leadInset]}
          testID={`${routeId}.lead`}
        >
          <Photo {...photoFields(lead, width + 2 * leadBleed)} aspect={leadBleed > 0 ? '4:3' : '16:9'} corner={leadBleed > 0 ? 'none' : 'xl'} priority="high" />
        </PressableScale>
      ) : null}
      {notices}
      <View style={styles.heading}>
        <View style={styles.tags}>
          <PressableScale
            role="link"
            aria-label={thread.category.name}
            onPress={() => router.push(categoryHref(thread.category.slug))}
            // The tag is 20 high; its 44 target is the pressable's hit area (hitSlop natively, a hit element on the web), so the tag
            // row keeps the tags' height and "Gelöst" and "Beispiel" stay on its line (DQ-P5-022, p5r1 touch-target).
            visualHeight={size.statusPill}
            testID={`${routeId}.category`}
          >
            <ForumTag label={thread.category.name} />
          </PressableScale>
          {thread.is_solved ? <SolvedBadge testID={`${routeId}.solved`} /> : null}
          {thread.is_pinned ? <ForumTag label={t('thread.pinned')} icon="push-pin" testID={`${routeId}.pinned`} /> : null}
          <SampleBadges flags={thread} testID={`${routeId}.badges`} />
        </View>
        <Text variant="title1" role="heading" {...({ 'aria-level': 1 } as object)} testID={`${routeId}.title`}>
          {thread.title}
        </Text>
        <PressableScale
          role="link"
          aria-label={name}
          disabled={!author}
          onPress={author ? () => onOpenMember(author.username) : undefined}
          // DQ-P5-024: the row goes on the visual (contentStyle); on the outer target it left the avatar above the name.
          contentStyle={styles.author}
          // p5r2 touch-target: the row is the 40 avatar high; its 44 target is the hit area, so the layout keeps its height.
          visualHeight={size.avatar.md}
          testID={`${routeId}.author`}
        >
          <Avatar name={name} uri={variantUrl(author?.avatar, size.avatar.md)} blurhash={author?.avatar?.blurhash} size={40} decorative />
          <View style={styles.authorText}>
            <Text variant="bodyStrong" numberOfLines={1} hyphenate={false}>
              {name}
            </Text>
            {created ? (
              <Text variant="caption" color="text.secondary" numeric hyphenate={false}>
                {format.relative(new Date(created))}
                {thread.edited_at ? ` · ${t('thread.edited')}` : ''}
              </Text>
            ) : null}
          </View>
        </PressableScale>
      </View>
      {thread.opening_deleted ? (
        <Text variant="callout" color="text.tertiary" testID={`${routeId}.openingDeleted`}>
          {t('thread.openingDeleted')}
        </Text>
      ) : (
        <ForumContent blocks={thread.content} testID={`${routeId}.body`} />
      )}
      {thread.tags.length > 0 ? (
        <View style={styles.tagList} testID={`${routeId}.tags`}>
          {thread.tags.map((tag) => (
            <Text key={tag} variant="caption" color="text.secondary" hyphenate={false}>
              {`#${tag}`}
            </Text>
          ))}
        </View>
      ) : null}
      {rest.length > 0 ? (
        <View style={styles.photos} role="list" aria-label={t('thread.photos')} testID={`${routeId}.photos`}>
          {rest.map((photo, index) => (
            <PressableScale
              key={photo.id}
              role="button"
              aria-label={t('thread.photo', { index: index + 2, count: thread.photos.length })}
              onPress={() => onOpenPhoto(index + 1)}
              style={[styles.photo, { width: tile }]}
              testID={`${routeId}.photo.${index + 1}`}
            >
              <Photo {...photoFields(photo, tile)} aspect="1:1" corner="sm" />
            </PressableScale>
          ))}
        </View>
      ) : null}
      <Attachments thread={thread} routeId={routeId} />
      {solution ? (
        <View style={styles.solution} testID={`${routeId}.solutionBlock`}>
          <View style={styles.solutionHead}>
            <SolvedBadge />
            {solution.author ? (
              <Text variant="caption" color="text.secondary" hyphenate={false}>
                {t('thread.solutionBy', { username: solution.author.username })}
              </Text>
            ) : null}
          </View>
          <ForumContent blocks={solution.content} variant="callout" />
          <Button
            label={t('thread.toSolution')}
            variant="tertiary"
            size="s"
            flush="start"
            onPress={() => onShowSolution(solution.id)}
            testID={`${routeId}.toSolution`}
          />
        </View>
      ) : null}
      {/* M5.9: the "KI-Zusammenfassung" of a long thread, collapsed, right above the replies it sums up. */}
      <ThreadSummary thread={thread} routeId={routeId} />
      <View style={styles.repliesHead}>
        <Text variant="calloutStrong" color="text.secondary" role="heading" {...({ 'aria-level': 2 } as object)} numeric testID={`${routeId}.repliesTitle`}>
          {thread.replies_count > 0 ? t('thread.replies', { count: thread.replies_count }) : t('thread.noReplies')}
        </Text>
        {thread.replies_count > 1 ? (
          <SegmentedControl
            options={[
              { value: 'oldest', label: t('thread.sortOldest'), testID: `${routeId}.sort.oldest` },
              { value: 'helpful', label: t('thread.sortHelpful'), testID: `${routeId}.sort.helpful` },
            ]}
            value={sort}
            onChange={onSort}
            label={t('thread.sortLabel')}
            labelVariant="labelControl"
            role="radiogroup"
            testID={`${routeId}.sort`}
          />
        ) : null}
        {thread.replies_count === 0 ? (
          <Text variant="callout" color="text.secondary" testID={`${routeId}.noReplies`}>
            {t('thread.noRepliesBody')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** What the thread is about (10 §7.1): the attached car, a mod of it or a parts product, each a link to its page. */
function Attachments({ thread, routeId }: { thread: ForumThread; routeId: string }) {
  const { t } = useTranslation('forum');
  const router = useRouter();
  const vehicle = thread.vehicle;
  const mod = thread.modification;
  const product = thread.product;
  if (!vehicle && !mod && !product) return null;
  const rows = [
    vehicle
      ? {
          key: 'vehicle',
          node: (divider: boolean) => (
            <ListRow
              key="vehicle"
              title={vehicle.full_title}
              subtitle={t('thread.attachedVehicle')}
              thumb={vehicle.cover ? photoFields(vehicle.cover, size.thumb.row) : undefined}
              icon={vehicle.cover ? undefined : 'garage'}
              role="link"
              onPress={() => router.push(`/v/${vehicle.slug}` as Href)}
              divider={divider}
              testID={`${routeId}.attached.vehicle`}
            />
          ),
        }
      : null,
    mod
      ? {
          key: 'mod',
          node: (divider: boolean) => (
            <ListRow
              key="mod"
              title={mod.title}
              subtitle={t('thread.attachedMod')}
              icon="wrench"
              role="link"
              onPress={vehicle && vehicle.id === mod.vehicle_id ? () => router.push({ pathname: '/v/[slug]/mods/[modId]', params: { slug: vehicle.slug, modId: mod.id } } as unknown as Href) : undefined}
              chevron={Boolean(vehicle && vehicle.id === mod.vehicle_id)}
              divider={divider}
              testID={`${routeId}.attached.mod`}
            />
          ),
        }
      : null,
    product
      ? {
          key: 'product',
          node: (divider: boolean) => (
            <ListRow
              key="product"
              title={product.full_name || product.name}
              subtitle={t('thread.attachedProduct')}
              icon="bag"
              role="link"
              onPress={() => router.push(`/products/${product.id}` as Href)}
              divider={divider}
              testID={`${routeId}.attached.product`}
            />
          ),
        }
      : null,
  ].filter((row): row is { key: string; node: (divider: boolean) => ReactElement } => row !== null);
  return (
    <RowGroup title={t('thread.attachments')} testID={`${routeId}.attached`}>
      {rows.map((row, index) => row.node(index < rows.length - 1))}
    </RowGroup>
  );
}

/** FOR-03's geometry while the thread loads: the lead photo, the tag line, two title lines, the author, the text. */
export function ThreadHeadSkeleton({ width, leadBleed, testID }: { width: number; leadBleed: number; testID: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={testID}>
      <View style={styles.root}>
        <View style={leadBleed > 0 ? { marginHorizontal: -leadBleed } : null}>
          <SkeletonBlock width={width + 2 * leadBleed} aspectRatio={leadBleed > 0 ? 4 / 3 : 16 / 9} corner={leadBleed > 0 ? 'none' : 'xl'} />
        </View>
        <View style={styles.heading}>
          {/* The tag row is the 20 tag's height, not a caption line's 16. */}
          <View style={styles.skeletonTags}>
            <SkeletonText variant="caption" width="30%" />
          </View>
          {/* DQ-P5-028 r2: two lines of title.1, as the threads' titles take on a phone and wider. */}
          <SkeletonText variant="title1" lines={2} lastLineWidth="55%" />
          <View style={styles.author}>
            <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
            <View style={styles.authorText}>
              <SkeletonText variant="bodyStrong" width="40%" />
              <SkeletonText variant="caption" width="25%" />
            </View>
          </View>
        </View>
        <SkeletonText variant="body" lines={4} lastLineWidth="60%" />
      </View>
    </Skeleton>
  );
}

/** The decision link for a forum ban, shown under the composer's restricted line. */
export function ForumDecisionLink({ routeId, decisionId }: { routeId: string; decisionId: string | null }) {
  if (!decisionId) return null;
  return <DecisionLink decisionId={decisionId} testID={`${routeId}.restricted.decision`} />;
}
