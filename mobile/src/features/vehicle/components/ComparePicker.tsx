import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMyVehicles } from '@/api/queries/profile';
import { normalizeQuery, useSearchOverview } from '@/api/queries/search';
import { useSavedBuilds } from '@/api/queries/social';
import type { VehicleMedia } from '@/api/queries/vehicles';
import { useSessionStore } from '@/state/session';
import { createStyles, space } from '@/theme';
import { EmptyState, ErrorState, ListRow, SearchBar, SectionHeader, Sheet, Skeleton, SkeletonText, Text } from '@/ui';

import { isSameBuild } from '../compare';
import { photoFields } from '../media';
import { SAVED_BUILDS_FLAG } from '../save';

const THUMB = 160;
const SEARCH_DELAY_MS = 300;
/** The sheet stays light: the first answers of each source. */
const PER_SOURCE = 8;
const SKELETON_ROWS = 3;

type Candidate = { slug: string; title: string; subtitle?: string; cover: VehicleMedia | null };

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[8] },
  group: { gap: t.space[4] },
  rows: { marginHorizontal: -t.space[4] },
  skeletonRow: { justifyContent: 'center', minHeight: t.size.row.withThumb },
}));

export type ComparePickerProps = {
  visible: boolean;
  onClose: () => void;
  /** The build that is compared: it is never offered. */
  current: string;
  onPick: (slug: string) => void;
  testID: string;
};

/**
 * VEH-01 more → "Vergleichen": the second build, from the member's garage, the saved builds or the search. A guest only searches.
 */
export function ComparePicker({ visible, onClose, current, onPick, testID }: ComparePickerProps) {
  const { t } = useTranslation('vehicle');
  return (
    <Sheet visible={visible} onClose={onClose} title={t('compare.picker.title')} initialSnap="full" testID={testID}>
      {/* The body unmounts with the sheet, so each opening starts with an empty search. */}
      <PickerBody current={current} onPick={onPick} testID={testID} />
    </Sheet>
  );
}

function PickerBody({ current, onPick, testID }: Pick<ComparePickerProps, 'current' | 'onPick' | 'testID'>) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const member = useSessionStore((state) => state.status === 'member');
  const savedEnabled = useFlag(SAVED_BUILDS_FLAG);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(normalizeQuery(text)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const garage = useMyVehicles();
  const saved = useSavedBuilds(savedEnabled && member);
  const search = useSearchOverview(query);

  const own = useMemo<Candidate[]>(
    () =>
      (member ? (garage.data ?? []) : [])
        .filter((card) => card.status === 'published' && !isSameBuild(card.slug, current))
        .slice(0, PER_SOURCE)
        .map((card) => ({ slug: card.slug, title: card.full_title, cover: card.cover })),
    [current, garage.data, member],
  );
  const savedRows = useMemo<Candidate[]>(
    () =>
      (saved.data?.pages[0]?.data ?? [])
        .filter((card) => !isSameBuild(card.slug, current))
        .slice(0, PER_SOURCE)
        .map((card) => ({ slug: card.slug, title: card.full_title, cover: card.cover })),
    [current, saved.data],
  );
  const results = useMemo<Candidate[]>(
    () =>
      (search.data?.vehicles.items ?? [])
        .filter((card) => !isSameBuild(card.slug, current))
        .map((card) => ({ slug: card.slug, title: card.full_title, subtitle: card.owner?.username ? `@${card.owner.username}` : undefined, cover: card.cover })),
    [current, search.data],
  );

  let content;
  if (query !== '') {
    if (search.data && results.length === 0) content = <EmptyState title={t('compare.picker.empty')} testID={`${testID}.empty`} />;
    else if (search.data) content = <Group title={t('compare.picker.results')} rows={results} onPick={onPick} testID={`${testID}.results`} />;
    else if (search.isError)
      content = <ErrorState title={t('compare.picker.errorTitle')} onRetry={() => void search.refetch()} retrying={search.isFetching} testID={`${testID}.error`} />;
    else content = <RowsSkeleton />;
  } else {
    content = (
      <>
        <Text variant="callout" color="text.secondary">
          {member ? t('compare.picker.hint') : t('compare.picker.hintGuest')}
        </Text>
        {own.length > 0 ? <Group title={t('compare.picker.garage')} rows={own} onPick={onPick} testID={`${testID}.garage`} /> : null}
        {savedRows.length > 0 ? <Group title={t('compare.picker.saved')} rows={savedRows} onPick={onPick} testID={`${testID}.saved`} /> : null}
      </>
    );
  }

  return (
    <View style={styles.body}>
      <SearchBar value={text} onChangeText={setText} placeholder={t('compare.picker.search')} autoFocus={false} testID={`${testID}.search`} />
      {content}
    </View>
  );
}

function Group({ title, rows, onPick, testID }: { title: string; rows: readonly Candidate[]; onPick: (slug: string) => void; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.group} testID={testID}>
      <SectionHeader title={title} />
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <ListRow
            key={row.slug}
            title={row.title}
            subtitle={row.subtitle}
            thumb={photoFields(row.cover, THUMB)}
            hyphenate={false}
            onPress={() => onPick(row.slug)}
            inset={space[4]}
            divider={index < rows.length - 1}
            testID={`${testID}.${index}`}
          />
        ))}
      </View>
    </View>
  );
}

function RowsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonText variant="body" width="70%" />
        </View>
      ))}
    </Skeleton>
  );
}
