import '@/features/events/i18n';

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { EventCard } from '@/api/queries/events';
import { EventCardView } from '@/features/events/components/EventCardView';
import { createStyles } from '@/theme';
import { Hairline } from '@/ui/Hairline';
import { SectionHeader } from '@/ui/SectionHeader';

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  list: { gap: t.space[16] },
}));

/**
 * M5.6 HOME-01 "Nächste Treffen" (10 §4, §11): the next two meets as EventCards (the first with its cover), real counts only, and
 * "Alle Treffen" to `/events`, the week view of Entdecken › Treffen. The caller passes `nextEvents(...)` and leaves the module out when
 * it is empty.
 */
export function NextEventsModule({ events, width, routeId }: { events: readonly EventCard[]; width: number; routeId: string }) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  if (events.length === 0) return null;
  return (
    <View testID={`${routeId}.events`}>
      <SectionHeader
        title={t('nextEvents.title')}
        actionLabel={t('nextEvents.all')}
        actionAccessibilityLabel={t('nextEvents.allLabel')}
        onAction={() => router.push('/events')}
        style={styles.header}
        testID={`${routeId}.events.header`}
      />
      <View style={styles.list} role="list">
        {events.map((event, index) => (
          <View key={event.id} style={styles.list} role="listitem">
            {index > 0 ? <Hairline /> : null}
            <EventCardView event={event} routeId={`${routeId}.events`} withCover={index === 0} coverWidth={width} />
          </View>
        ))}
      </View>
    </View>
  );
}
