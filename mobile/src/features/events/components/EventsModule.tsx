import '@/features/events/i18n';

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { EventCard } from '@/api/queries/events';
import { createStyles } from '@/theme';
import { Hairline, SectionHeader } from '@/ui';

import { EventCardView } from './EventCardView';

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  list: { gap: t.space[16] },
}));

/**
 * HOME-01 "Treffen in deiner Nähe" and DISC-01 "Treffen am Wochenende" (09 §7.3, §7.5): the first cards with "Alle Treffen", the
 * first with its cover. Hidden by the caller when there is nothing to show (never an empty module).
 */
export function EventsModule({
  title,
  events,
  limit,
  width,
  allPath = '/events',
  routeId,
}: {
  title: string;
  events: readonly EventCard[];
  limit: number;
  /** The column width, for the cover's image variant. */
  width: number;
  allPath?: string;
  routeId: string;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const shown = events.slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <View testID={`${routeId}.events`}>
      <SectionHeader
        title={title}
        actionLabel={t('list.all')}
        actionAccessibilityLabel={t('list.allLabel')}
        onAction={() => router.push(allPath)}
        style={styles.header}
        testID={`${routeId}.events.header`}
      />
      <View style={styles.list}>
        {shown.map((event, index) => (
          <View key={event.id} style={styles.list}>
            {index > 0 ? <Hairline /> : null}
            <EventCardView
              event={event}
              routeId={`${routeId}.events`}
              withCover={index === 0}
              coverWidth={width}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
