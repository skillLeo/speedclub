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
import { MediaCard, MediaCardSkeleton, SectionHeader, Skeleton, SkeletonText } from '@/ui';

import { collectionPath, searchPath } from '../navigation';
import { SearchMemberRow } from './SearchMemberRow';

/** A rail card at font scale 1: two cards and the start of a third on a 390 phone, so the row shows that it scrolls (09 §5 rail). */
export const RAIL_CARD_WIDTH = space[64] * 2 + space[24];
const MAX_CARD_SCALE = 1.5;
/** From 1280 the column has open canvas beside it: the cards form a grid of this many columns instead of a strip (DQ-329). */
const GRID_COLUMNS = 3;

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  gap: { width: t.space[12] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  members: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, paddingHorizontal: t.space[16] },
  skeletonRow: { flexDirection: 'row', gap: t.space[12], overflow: 'hidden' },
}));

function Gap() {
  const styles = useStyles();
  return <View style={styles.gap} />;
}

/** The rail card's width: it grows with the font up to 1.5×, never wider than the column less a peek of the next card. */
export function railCardWidth(column: number, fontScale: number): number {
  return Math.max(0, Math.min(Math.round(RAIL_CARD_WIDTH * Math.min(MAX_CARD_SCALE, Math.max(1, fontScale))), column - space[48]));
}

/** The grid's card width from 1280: three columns inside the column. */
export function railGridWidth(column: number): number {
  return Math.floor((column - space[12] * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
}

function useCardWidth(column: number): { width: number; grid: boolean } {
  const { fontScale } = useTheme();
  const grid = useBreakpoint().kind === 'desktop';
  return { width: grid ? railGridWidth(column) : railCardWidth(column, fontScale), grid };
}

export type CollectionsProps = {
  collections: readonly DiscoverCollection[];
  /** The column's inner width and its gutter, for the bleed. */
  column: number;
  gutter: number;
  testID: string;
};

/**
 * FS-11 "Kollektionen" as the 09 §7.5 photo rail: admin-curated sets as `rail` MediaCards (3:4, radius 12) in a row that scrolls
 * sideways, run to the screen edge on a phone; each opens DISC-02 with its chips. "Beliebte Modelle" takes this place once the API
 * names popular models with a cover (lane B).
 */
export function Collections({ collections, column, gutter, testID }: CollectionsProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const { width, grid } = useCardWidth(column);
  const cardStyle = useMemo(() => ({ width }), [width]);
  const renderItem = useCallback(
    ({ item }: { item: DiscoverCollection }) => {
      const count = countLabel(item.count, item.count_capped, format.number);
      return (
        <MediaCard
          variant="rail"
          title={item.title}
          spec={t('collections.count', { count: item.count, formatted: count })}
          photo={photoFields(item.cover, width)}
          onPress={() => router.push(collectionPath(item.filters, item.sort))}
          style={cardStyle}
          testID={`${testID}.${item.key}`}
        />
      );
    },
    [cardStyle, format.number, router, t, testID, width],
  );
  if (collections.length === 0) return null;
  if (grid) {
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

/** The rail while DISC-01 loads: the cards the page draws first, in their geometry (MediaCardSkeleton `rail`). */
export function CollectionsSkeleton({ column, testID }: { column: number; testID: string }) {
  const styles = useStyles();
  const { width, grid } = useCardWidth(column);
  const shown = grid ? GRID_COLUMNS : Math.max(1, Math.ceil(column / (width + space[12])));
  return (
    <Skeleton testID={testID}>
      <SkeletonText variant="headline" width="35%" style={styles.header} />
      <View style={styles.skeletonRow}>
        {Array.from({ length: shown }, (_, index) => (
          <MediaCardSkeleton key={index} variant="rail" style={{ width }} />
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
