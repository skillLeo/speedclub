import '@/features/events/i18n';

import { useRouter } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { StyleProp, ViewStyle } from 'react-native';

import type { EventCard as EventCardData } from '@/api/queries/events';
import { photoFields } from '@/features/profile/media';
import { now } from '@/lib/clock';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';
import { size } from '@/theme';
import { EventCard, type PhotoFields } from '@/ui';

import {
  cardCaption,
  cardCounts,
  dateBlock,
  eventPath,
  FALLBACK_COVER,
  hasEnded,
  parseInstant,
  statusLabel,
} from '../model';
import { useEventRsvp } from '../useEventRsvp';

export type EventCardViewProps = {
  event: EventCardData;
  routeId: string;
  /** The 16:9 cover above the row (the list's first card, the modules). */
  withCover?: boolean;
  coverWidth?: number;
  /** DQ-1111 (EVT-05): the event's own cover as a square thumbnail at the row's end, when it has one. */
  withThumb?: boolean;
  /** EVT-05 Organisiert: the status pill of every own event; elsewhere only a cancelled one shows its state. */
  showStatus?: boolean;
  /** Replaces the RSVP button. */
  trailing?: ReactNode;
  /** The empty states' sample: drawn, never opened. */
  inert?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** An API event as the 09 §5 EventCard: date block, title, place and time, the real answers, and "Zusagen" where it may be given. */
export const EventCardView = memo(function EventCardView({
  event,
  routeId,
  withCover = false,
  coverWidth,
  withThumb = false,
  showStatus = false,
  trailing,
  inert = false,
  style,
}: EventCardViewProps) {
  const { t } = useTranslation('events');
  const format = useFormat();
  const router = useRouter();
  const own = useSessionStore((state) => state.member?.username);
  const { answer, pendingFor } = useEventRsvp(routeId);
  const start = parseInstant(event.starts_at);
  const block = start ? dateBlock(start, format.locale) : { day: '–', month: '', weekday: '' };
  const cancelled = event.status === 'cancelled';
  const ended = hasEnded(event, now());
  const organiser =
    own !== undefined && own !== null && own.toLowerCase() === event.organiser.username.toLowerCase();
  const answerable = !event.is_sample && !cancelled && !ended && !organiser && event.status === 'published';
  const going = event.my_rsvp === 'going' || event.my_rsvp === 'waitlist';
  // A card shows a stand-in photo only on a sample (badged "Beispiel"); a real event without a cover keeps its row, since a card has no
  // room to say "Symbolbild" (DQ-1111: the event's page shows the fallback with that caption).
  const cover: PhotoFields | null = withCover
    ? event.cover
      ? photoFields(event.cover, coverWidth ?? 0)
      : event.is_sample
        ? FALLBACK_COVER
        : null
    : null;
  const thumb: PhotoFields | null =
    withThumb && !withCover && event.cover ? photoFields(event.cover, size.thumb.row) : null;
  const status = showStatus || cancelled ? statusLabel(event.status, t) : null;
  const testID = `${routeId}.event.${event.is_sample && event.id === 'sample-event' ? 'sample' : event.id}`;

  return (
    <EventCard
      day={block.day}
      month={block.month}
      weekday={block.weekday}
      title={event.title}
      caption={cardCaption(event, format.locale, t, (km) => format.distance(km))}
      counts={cardCounts(event, t, (n) => format.number(n))}
      cover={cover}
      thumb={thumb}
      coverWidth={coverWidth}
      sample={{ is_sample: event.is_sample, is_editorial: event.organiser.is_editorial && !event.is_sample }}
      status={status}
      muted={cancelled || ended}
      inert={inert}
      trailing={trailing}
      rsvp={
        answerable
          ? {
              label: going
                ? event.my_rsvp === 'waitlist'
                  ? t('rsvp.waitlist')
                  : t('rsvp.goingDone')
                : t('rsvp.going'),
              selected: going,
              loading: pendingFor === event.id,
              accessibilityLabel: going
                ? t('rsvp.cardLabelDone', { title: event.title })
                : t('rsvp.cardLabel', { title: event.title }),
              // A given answer is changed on the event's page, where withdrawing is a deliberate step.
              onPress: () => (going ? router.push(eventPath(event.slug)) : answer(event, 'going')),
            }
          : null
      }
      onPress={() => router.push(eventPath(event.slug))}
      style={style}
      testID={testID}
    />
  );
});
