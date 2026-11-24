import '@/features/events/i18n';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCheckinEnabled, useMyCheckins, type EventCheckinCard } from '@/api/queries/eventCheckin';
import { now } from '@/lib/clock';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { EventCardSkeleton } from '@/ui/EventCard';
import { SectionHeader } from '@/ui/SectionHeader';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { dayText, parseInstant } from '../model';
import { EventCardView } from './EventCardView';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12], marginTop: t.space[32] },
  cards: { gap: t.space[24] },
  // p5r2 (off-scale 72 padding): the line is the card's footer item, so it sits in the card's own text column after the date block,
  // on a line of its own under the counts, without a padding of its own.
  on: { flexBasis: '100%' },
}));

/** Unique by event, newest first as the server sends them. */
function uniqueCards(pages: readonly { data: EventCheckinCard[] }[] | undefined): EventCheckinCard[] {
  const seen = new Set<string>();
  return (pages ?? []).flatMap((page) => page.data).filter((card) => (seen.has(card.id) ? false : (seen.add(card.id), true)));
}

/**
 * M5.6 PROF-01 Treffen "War dabei" (10 §4; m5.6-contract §5.3 `me/checkins`), behind `events.checkin`: the meets the member checked
 * in at, each EventCard with its day and, for one hidden from the profile, "Nur für dich sichtbar". Quiet by design: nothing while the
 * flag is off or the member has no check-in yet (the Treffen tab keeps its own empty state), a line with "Erneut laden" on an error.
 */
export function CheckinsSection({ routeId }: { routeId: string }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const enabled = useCheckinEnabled();
  const query = useMyCheckins(enabled);
  const cards = useMemo(() => uniqueCards(query.data?.pages), [query.data?.pages]);

  if (!enabled) return null;
  const loading = !query.data && query.isPending && query.fetchStatus !== 'paused';
  if (!loading && !query.isError && cards.length === 0) return null;
  if (!loading && !query.data) {
    return (
      <View style={styles.root} testID={`${routeId}.checkins.error`}>
        <Text variant="callout" color="text.secondary">
          {t('checkin.section.error')}
        </Text>
        <Button
          label={t('checkin.section.retry')}
          variant="tertiary"
          size="s"
          flush="start"
          loading={query.isFetching}
          onPress={() => void query.refetch()}
          testID={`${routeId}.checkins.retry`}
        />
      </View>
    );
  }
  return (
    <View style={styles.root} testID={`${routeId}.checkins`}>
      <SectionHeader title={t('checkin.section.title')} testID={`${routeId}.checkins.header`} />
      {loading ? (
        <Skeleton testID={`${routeId}.checkins.skeleton`}>
          <EventCardSkeleton />
        </Skeleton>
      ) : (
        <View style={styles.cards} role="list">
          {cards.map((card) => {
            const at = parseInstant(card.checked_in_at);
            return (
              <View key={card.id} role="listitem">
                <EventCardView
                  event={card}
                  routeId={`${routeId}.checkins`}
                  trailing={
                    // A date never breaks inside its month ("19. Ok- / tober" at 200 %): no hyphenation; dayText binds day and month.
                    <Text variant="caption" color="text.secondary" numeric hyphenate={false} style={styles.on} testID={`${routeId}.checkins.${card.id}.on`}>
                      {[
                        at ? t('checkin.section.checkedInOn', { date: dayText(at, format.locale, now()) }) : null,
                        card.profile_visible ? null : t('checkin.section.hidden'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  }
                />
              </View>
            );
          })}
          {query.hasNextPage ? (
            <Button
              label={t('checkin.section.more')}
              variant="tertiary"
              size="s"
              flush="start"
              loading={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              testID={`${routeId}.checkins.more`}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
