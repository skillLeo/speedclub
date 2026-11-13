import '@/features/events/i18n';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { EventDetail } from '@/api/queries/events';
import { createStyles, useBreakpoint, useTheme } from '@/theme';
import { Button, ChromeSurface, Icon, Text } from '@/ui';

import { spotsLeft, waitlistPosition } from '../model';
import { useEventRsvp } from '../useEventRsvp';

const useStyles = createStyles((t) => ({
  frame: { alignItems: 'center' },
  bar: {
    alignSelf: 'center',
    borderRadius: t.radius.xl,
    gap: t.space[8],
    maxWidth: t.layout.feedColumn,
    padding: t.space[12],
    width: '100%',
  },
  edge: { borderColor: t.color.border.subtle, borderWidth: t.size.border.control },
  state: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], paddingHorizontal: t.space[4] },
  stateText: { flex: 1, minWidth: 0 },
  row: {
    alignItems: 'center',
    columnGap: t.space[8],
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: t.space[8],
  },
  grow: { flexGrow: 1 },
  inline: { gap: t.space[8] },
}));

export type RsvpBarProps = {
  event: EventDetail;
  organiser: boolean;
  guest: boolean;
  ended: boolean;
  onShare: () => void;
  onCalendar: () => void;
  onManage: () => void;
  routeId: string;
  /** DQ-1114: inside the desktop's sticky side card, as plain content instead of floating chrome. */
  inline?: boolean;
};

/**
 * EVT-02's floating answer bar (09 §7.10, floating chrome 09 §4.4): primary "Zusagen" (the page's one filled CTA) and secondary
 * "Interessiert"; once going "Zugesagt" with "In Kalender" and "Teilen"; on the waitlist its place. The organiser gets "Verwalten".
 * A cancelled, past or unpublished event has no bar: the page says why. Answers are optimistic (useRsvp).
 */
export function RsvpBar({
  event,
  organiser,
  guest,
  ended,
  onShare,
  onCalendar,
  onManage,
  routeId,
  inline = false,
}: RsvpBarProps) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const light = useTheme().colorScheme === 'light';
  const { gutter } = useBreakpoint();
  const { answer, pendingFor } = useEventRsvp(routeId);
  const busy = pendingFor === event.id;
  const id = (part: string) => `${routeId}.rsvp.${part}`;

  if (event.status !== 'published' && !(organiser && event.status !== 'cancelled')) return null;
  if (ended && !organiser) return null;

  let state: { icon: 'check' | 'clock' | 'info'; text: string } | null = null;
  let content: ReactNode;
  const full = spotsLeft(event) === 0;

  if (organiser) {
    state = { icon: 'info', text: t('rsvp.organiser') };
    content = (
      <Button
        label={t('rsvp.manage')}
        size="m"
        onPress={onManage}
        style={styles.grow}
        fullWidth
        testID={id('manage')}
      />
    );
  } else if (event.is_sample) {
    state = { icon: 'info', text: t('detail.sample') };
    content = null;
  } else if (event.my_rsvp === 'going') {
    state = { icon: 'check', text: t('rsvp.goingDone') };
    content = (
      <>
        {event.calendar_url ? (
          <Button
            label={t('rsvp.calendar')}
            icon="calendar-plus"
            variant="secondary"
            size="m"
            onPress={onCalendar}
            testID={id('calendar')}
          />
        ) : null}
        <Button
          label={t('rsvp.share')}
          icon="share-network"
          variant="secondary"
          size="m"
          onPress={onShare}
          testID={id('share')}
        />
        <Button
          label={t('rsvp.withdraw')}
          variant="tertiary"
          size="m"
          loading={busy}
          onPress={() => answer(event, null)}
          testID={id('withdraw')}
        />
      </>
    );
  } else if (event.my_rsvp === 'waitlist') {
    const position = waitlistPosition(event);
    state = { icon: 'clock', text: position ? t('rsvp.waitlistPosition', { position }) : t('rsvp.waitlist') };
    content = (
      <>
        <Button
          label={t('rsvp.share')}
          icon="share-network"
          variant="secondary"
          size="m"
          onPress={onShare}
          testID={id('share')}
        />
        <Button
          label={t('rsvp.leaveWaitlist')}
          variant="tertiary"
          size="m"
          loading={busy}
          onPress={() => answer(event, null)}
          testID={id('leave')}
        />
      </>
    );
  } else if (!event.can.rsvp && !guest) {
    content = (
      <Button
        label={t('rsvp.share')}
        icon="share-network"
        variant="secondary"
        size="m"
        onPress={onShare}
        testID={id('share')}
      />
    );
  } else {
    const interested = event.my_rsvp === 'interested';
    if (interested) state = { icon: 'check', text: t('rsvp.interestedDone') };
    content = (
      <>
        <Button
          label={full ? t('rsvp.joinWaitlist') : t('rsvp.going')}
          size="m"
          loading={busy}
          onPress={() => answer(event, 'going')}
          style={styles.grow}
          testID={id('going')}
        />
        {interested ? (
          <Button
            label={t('rsvp.notInterested')}
            variant="tertiary"
            size="m"
            onPress={() => answer(event, null)}
            testID={id('notInterested')}
          />
        ) : (
          <Button
            label={t('rsvp.interested')}
            variant="secondary"
            size="m"
            onPress={() => answer(event, 'interested')}
            testID={id('interested')}
          />
        )}
      </>
    );
  }

  const body = (
    <>
      {state ? (
        <View style={styles.state} role="status" testID={id('state')}>
          <Icon name={state.icon} size={20} color="text.primary" />
          <Text variant="calloutStrong" numeric style={styles.stateText}>
            {state.text}
          </Text>
        </View>
      ) : null}
      {content ? <View style={styles.row}>{content}</View> : null}
    </>
  );
  if (inline) {
    return (
      <View style={styles.inline} testID={`${routeId}.rsvp`}>
        {body}
      </View>
    );
  }
  return (
    <View style={[styles.frame, { paddingHorizontal: gutter }]} testID={`${routeId}.rsvp`}>
      <ChromeSurface floating style={[styles.bar, light ? styles.edge : null]}>
        {body}
      </ChromeSurface>
    </View>
  );
}
