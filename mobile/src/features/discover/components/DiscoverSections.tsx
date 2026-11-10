import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { DiscoverCollection } from '@/api/queries/discover';
import type { PopularMod } from '@/api/queries/home';
import { countLabel, type SearchMember } from '@/api/queries/search';
import { PopularModsChips } from '@/features/home/components/PopularModsChips';
import { photoFields } from '@/features/profile/media';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space, useBreakpoint, useTheme } from '@/theme';
import { SectionHeader, Skeleton, SkeletonBlock, SkeletonText } from '@/ui';

import { collectionPath, searchPath } from '../navigation';
import { CollectionCard } from './CollectionCard';
import { SearchMemberRow } from './SearchMemberRow';

/** A collection card at font scale 1: wide enough for "Golf GTI Generationen" in `title.s`, with the next card peeking in. */
export const COLLECTION_CARD_WIDTH = space[64] * 4 + space[24];
const MAX_CARD_SCALE = 1.5;

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  gap: { width: t.space[12] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  members: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, paddingHorizontal: t.space[16] },
  skeletonRow: { flexDirection: 'row', gap: t.space[12] },
  skeletonCard: { gap: t.space[8] },
}));

function Gap() {
  const styles = useStyles();
  return <View style={styles.gap} />;
}

function useCardWidth(column: number): number {
  const { fontScale } = useTheme();
  // Never wider than the column less a peek of the next card, so a phone shows that the row scrolls.
  return Math.min(Math.round(COLLECTION_CARD_WIDTH * Math.min(MAX_CARD_SCALE, Math.max(1, fontScale))), column - space[48]);
}

export type CollectionsProps = {
  collections: readonly DiscoverCollection[];
  /** The column's inner width and its gutter, for the bleed. */
  column: number;
  gutter: number;
  testID: string;
};

/** FS-11 "Kollektionen": admin-curated sets as 16:9 cards in a row that scrolls sideways; each opens DISC-02 with its chips. */
export function Collections({ collections, column, gutter, testID }: CollectionsProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const grid = useBreakpoint().kind === 'desktop';
  const gridWidth = Math.floor((column - space[12]) / 2);
  const stripWidth = useCardWidth(column);
  const width = grid ? gridWidth : stripWidth;
  const cardStyle = useMemo(() => ({ width }), [width]);
  const renderItem = useCallback(
    ({ item }: { item: DiscoverCollection }) => {
      const count = countLabel(item.count, item.count_capped, format.number);
      return (
        <View style={cardStyle}>
          <CollectionCard
            title={item.title}
            subtitle={item.subtitle}
            countLabel={t('collections.count', { count: item.count, formatted: count })}
            photo={photoFields(item.cover, width)}
            onPress={() => router.push(collectionPath(item.filters, item.sort))}
            testID={`${testID}.${item.key}`}
          />
        </View>
      );
    },
    [cardStyle, format.number, router, t, testID, width],
  );
  if (collections.length === 0) return null;
  if (grid) {
    // DQ-329: from 1280 the column has open canvas beside it, so a strip would end in a hard cut there. Two columns of cards
    // inside the column instead, every collection in view.
    return (
      <View testID={testID}>
        <SectionHeader title={t('collections.title')} style={styles.header} testID={`${testID}.header`} />
        <View role="list" style={styles.grid} testID={`${testID}.list`}>
          {collections.map((item) => (
            <View key={item.key} role="listitem">
              {renderItem({ item })}
            </View>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View testID={testID}>
      <SectionHeader title={t('collections.title')} style={styles.header} testID={`${testID}.header`} />
      <View style={{ marginHorizontal: -gutter }}>
        <FlashList
          horizontal
          data={collections}
          keyExtractor={(item: DiscoverCollection) => item.key}
          renderItem={renderItem}
          ItemSeparatorComponent={Gap}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: gutter }}
          testID={`${testID}.list`}
        />
      </View>
    </View>
  );
}

/** The cards while DISC-01 loads: two 16:9 blocks with their text lines, where the row will be. */
export function CollectionsSkeleton({ column, testID }: { column: number; testID: string }) {
  const styles = useStyles();
  const strip = useCardWidth(column);
  // The same two cards the page draws: the strip's first two on a phone, the grid's first row from 1280.
  const width = useBreakpoint().kind === 'desktop' ? Math.floor((column - space[12]) / 2) : strip;
  return (
    <Skeleton testID={testID}>
      <SkeletonText variant="titleS" width="35%" style={styles.header} />
      <View style={styles.skeletonRow}>
        {[0, 1].map((index) => (
          <View key={index} style={[styles.skeletonCard, { width }]}>
            <SkeletonBlock width={width} height={Math.round((width * 9) / 16)} corner="md" />
            <SkeletonText variant="titleS" width="70%" />
            <SkeletonText variant="caption" width="30%" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** FS-11 "Beliebte Mods": the same chips as HOME-01, each searching for its part. */
export function PopularMods({ mods, column, testID }: { mods: readonly PopularMod[]; column: number; testID: string }) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const router = useRouter();
  const open = useCallback((mod: PopularMod) => router.push(searchPath(mod.query)), [router]);
  if (mods.length === 0) return null;
  return (
    <View>
      <SectionHeader title={t('popularMods.title')} style={styles.header} testID={`${testID}.header`} />
      <PopularModsChips mods={mods} width={column} onOpen={open} testID={testID} />
    </View>
  );
}

/** [SIG `sig.similar_builds`] "Mitglieder mit ähnlichen Autos": member rows with their garage line; null or empty hides it. */
export function SimilarMembers({ members, testID }: { members: readonly SearchMember[] | null; testID: string }) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const router = useRouter();
  const open = useCallback(
    (member: SearchMember) => {
      if (member.is_self) router.navigate('/profile');
      else router.push({ pathname: '/u/[username]', params: { username: member.username } });
    },
    [router],
  );
  if (!members || members.length === 0) return null;
  return (
    <View testID={testID}>
      <SectionHeader title={t('similarMembers.title')} style={styles.header} testID={`${testID}.header`} />
      <View role="list" style={styles.members}>
        {members.map((member, index) => (
          <View key={member.username} role="listitem">
            <SearchMemberRow member={member} onOpen={open} divider={index < members.length - 1} testID={`${testID}.${member.username}`} />
          </View>
        ))}
      </View>
    </View>
  );
}
