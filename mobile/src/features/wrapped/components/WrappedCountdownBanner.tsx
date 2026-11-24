import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMyWrapped, wrappedQa } from '@/api/queries/wrapped';
import { now } from '@/lib/clock';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons/Icon';
import { Text } from '@/ui/Text';

import { countdownDays, dismissCountdown, showsCountdown, useDismissedCountdowns, wrappedTitle } from '../model';
import '../qaWrapped';

const useStyles = createStyles((t) => ({
  // As the announcement banner above it: a raised surface, the glyph, two lines, the dismiss target in the corner.
  card: {
    alignItems: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.md,
    flexDirection: 'row',
    gap: t.space[12],
    paddingBottom: t.space[12],
    paddingLeft: t.space[16],
    paddingTop: t.space[12],
  },
  icon: { marginTop: t.space[4] },
  text: { flex: 1, gap: t.space[4], minWidth: 0, paddingTop: t.space[4] },
  dismiss: { marginTop: -t.space[8] },
}));

export type WrappedCountdownBannerProps = { routeId: string; style?: StyleProp<ViewStyle> };

/**
 * Start (contract §1/§6): "Dein Wrapped 2027 kommt in 3 Tagen" in the last 7 days before a release, only when the server sends the
 * countdown (flag `wrapped.countdown`). Dismissed for this session with the cross; no push, no badge, no pressure.
 */
export function WrappedCountdownBanner({ routeId, style }: WrappedCountdownBannerProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const dismissed = useDismissedCountdowns();
  // Client round 6 (L2): Home asks only while the banner can show at all, `wrapped` (in the hook) and `wrapped.countdown` on.
  // The bundled `qaWrapped` sample reads no server and keeps its countdown cells.
  const countdownOn = useFlag('wrapped.countdown');
  const query = useMyWrapped(countdownOn || wrappedQa() !== null);
  const countdown = query.data?.countdown;
  const today = now();
  if (!showsCountdown(countdown, today, dismissed)) return null;
  const release = new Date(countdown.release_at);
  const days = countdownDays(countdown.release_at, today) ?? 0;
  const title = wrappedTitle(t, countdown.season_key);
  const id = `${routeId}.wrappedCountdown`;
  return (
    <View style={[styles.card, style]} role="region" aria-label={title} testID={id}>
      <View style={styles.icon}>
        <Icon name="calendar-blank" size={20} color="text.primary" />
      </View>
      <View style={styles.text}>
        <Text variant="headline" numeric testID={`${id}.title`}>
          {days === 0 ? t('wrapped.countdown.today', { title }) : t('wrapped.countdown.days', { title, count: days })}
        </Text>
        <Text variant="callout" color="text.secondary" numeric>
          {t('wrapped.countdown.body', { date: format.longDate(release), time: format.time(release) })}
        </Text>
      </View>
      <IconButton icon="x" label={t('wrapped.countdown.dismiss')} onPress={() => dismissCountdown(countdown.season_key)} style={styles.dismiss} testID={`${id}.dismiss`} />
    </View>
  );
}
