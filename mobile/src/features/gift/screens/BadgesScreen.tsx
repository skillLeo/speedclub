import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { BADGE_CATEGORIES, orderBadges, publicBadges, useMemberBadges, useMyBadges, type Badge, type BadgeCategory } from '@/api/queries/badges';
import { useDiscoverColumn } from '@/features/discover/layout';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, space, useTheme } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Header } from '@/ui/Header';
import { ListRow } from '@/ui/ListRow';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { estimateLines, Skeleton, SkeletonBlock, SkeletonText, useSkeletonType } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { RowGroup } from '@/ui/RowGroup';

import { BadgeSheet } from '../components/BadgeSheet';
import { BadgeChip } from '../components/ProfileGift';
import { qaBadges, qaGiftActive } from '../qaGift';

const ROUTE = 'BDG-01';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { gap: t.space[32], paddingBottom: t.space[32], paddingTop: t.space[8] },
  intro: { gap: t.space[4] },
  section: { gap: t.space[12] },
  preview: { alignItems: 'flex-start', gap: t.space[12], width: '100%' },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  skeleton: { gap: t.space[32] },
}));

type Group = { category: BadgeCategory | 'other'; badges: Badge[] };

/** The badges by category in the contract's order (§2), each group earned first; categories without a badge are left out. */
export function groupBadges(badges: readonly Badge[]): Group[] {
  const order: (BadgeCategory | 'other')[] = [...BADGE_CATEGORIES, 'other'];
  return order
    .map((category) => ({ category, badges: orderBadges(badges.filter((badge) => (badge.category ?? 'other') === category)) }))
    .filter((group) => group.badges.length > 0);
}

/** About the length of a seeded badge description (BadgeSeeder: 25–80 characters), for the skeleton's row height. */
const DESCRIPTION_CHARS = 52;
/** A date value ("3. Okt. 2026"): its characters and the em width of a tabular figure line. */
const DATE_CHARS = 12;
const DATE_CHAR_EM = 0.5;
/** The first groups of the seeded catalogue (Garage, Mods, Spotting), by their rows. */
const SKELETON_GROUPS = [1, 1, 2] as const;

/**
 * DQ-P5-204: the page in the shape it will have. The intro as drawn (the QA set's "Beispiel" badge, the own count, two lines of
 * rules), then groups of rows with an icon, the badge name, the description wrapped to the text column and the date beside it.
 */
function BadgesSkeleton({ own }: { own: boolean }) {
  const styles = useStyles();
  const { inner } = useDiscoverColumn();
  const { fontScale } = useTheme();
  const type = useSkeletonType();
  // The text column of a ListRow in a RowGroup: 16 inset each side, the glyph and 12, the date and the chevron with their gaps.
  const date = DATE_CHARS * type('callout').fontSize * DATE_CHAR_EM;
  const column = inner - 2 * space[16] - size.icon.m - space[12] - space[12] - date - space[8] - size.icon.s;
  const lines = estimateLines(DESCRIPTION_CHARS, 'callout', fontScale, column);
  const row = Math.max(size.row.single, type('body').lineHeight + lines * type('callout').lineHeight + 2 * space[8]);
  return (
    <Skeleton testID={`${ROUTE}.skeleton`} style={styles.skeleton}>
      <View style={styles.intro}>
        {qaGiftActive() ? <SkeletonBlock width={size.touchMin * 2} height={size.statusPill} corner="xs" /> : null}
        {own ? <SkeletonText variant="headline" width="40%" /> : null}
        <SkeletonText variant="callout" lines={2} />
      </View>
      {SKELETON_GROUPS.map((rows, index) => (
        <View key={index} style={styles.section}>
          <SkeletonText variant="headline" width="30%" />
          <SkeletonBlock width="100%" height={row * rows} corner="md" testID={`${ROUTE}.skeleton.group`} />
        </View>
      ))}
    </Skeleton>
  );
}

function BadgeRows({ groups, onOpen }: { groups: readonly Group[]; onOpen: (badge: Badge) => void }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  return (
    <>
      {groups.map((group) => (
        <View key={group.category} style={styles.section} testID={`${ROUTE}.group.${group.category}`}>
          <SectionHeader title={t(`gift.badges.category.${group.category}`)} level={2} />
          <RowGroup>
            {group.badges.map((badge, index) => {
              const hidden = badge.hidden;
              const title = hidden ? t('gift.badges.hiddenName') : (badge.name ?? '');
              const subtitle = hidden ? (badge.hint ? t('gift.badges.hint', { hint: badge.hint }) : t('gift.badges.hiddenLabel')) : (badge.description ?? undefined);
              return (
                <ListRow
                  key={badge.key}
                  icon={hidden ? 'question' : badge.earned_at ? 'medal' : 'lock-simple'}
                  title={title}
                  accessibilityTitle={hidden ? `${title}, ${t('gift.badges.hiddenLabel')}` : t(badge.earned_at ? 'gift.badges.earnedLabel' : 'gift.badges.lockedLabel', { name: title })}
                  subtitle={subtitle}
                  value={badge.earned_at ? format.date(new Date(badge.earned_at)) : undefined}
                  onPress={() => onOpen(badge)}
                  divider={index < group.badges.length - 1}
                  inset={space[16]}
                  testID={`${ROUTE}.badge.${badge.key}`}
                />
              );
            })}
          </RowGroup>
        </View>
      ))}
    </>
  );
}

/**
 * BDG-01 Abzeichen (contract §2, §8), from the badge row of PROF-01 (`/profile/badges`: every badge, earned first, "???" with the
 * hint for hidden ones) and PROF-02 (`/u/{username}/badges`: what that member earned). Grouped by category; a row opens the detail
 * sheet. Fixed rules, never chance: the page says so.
 */
export function BadgesScreen({ own = false }: { own?: boolean }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const online = useOnline();
  const qaState = useQaState();
  const inset = useTabBarInset();
  const column = useDiscoverColumn();
  const requireAuth = useRequireAuth();
  const addVehicle = useAddVehicle();
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.member?.username ?? null);
  const params = useLocalSearchParams<{ username?: string | string[] }>();
  const username = own ? me : (paramOf(params.username) ?? null);
  const back = useBack(own ? '/profile' : `/u/${username ?? ''}`);
  const [open, setOpen] = useState<Badge | null>(null);
  const mine = useMyBadges(own);
  const member = useMemberBadges(own ? undefined : (username ?? undefined), !own);
  const query = own ? mine : member;
  const data = qaState === 'default' || qaState === 'offline' ? query.data : undefined;
  const badges = data ? (own ? data : publicBadges(data)) : undefined;
  const error = query.error instanceof ApiError ? query.error : null;
  const earned = badges?.filter((badge) => badge.earned_at !== null).length ?? 0;

  let body: ReactNode;
  if (own && status === 'guest') {
    body = (
      <EmptyState
        icon="medal"
        title={t('gift.badges.guestTitle')}
        action={{ label: t('gift.badges.signIn'), onPress: () => requireAuth(undefined, { returnTo: '/profile/badges' }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (qaState === 'restricted' || error?.kind === 'not_found' || error?.kind === 'forbidden') {
    body = <EmptyState icon="lock-simple" title={t('gift.badges.restricted')} testID={`${ROUTE}.restricted`} />;
  } else if (qaState === 'loading' || status === 'loading' || (!badges && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) {
    body = <BadgesSkeleton own={own} />;
  } else if (qaState === 'error' || (!badges && qaState !== 'empty')) {
    const offline = qaState !== 'error' && (!online || query.fetchStatus === 'paused');
    body = (
      <ErrorState
        title={offline ? t('gift.badges.offline') : t('gift.badges.errorTitle')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (qaState === 'empty' || !badges || earned === 0) {
    // 09 §5 "never empty": three badges as they will look, badged; the own page leads to the first car, another's says who.
    const sample = qaBadges().filter((badge) => badge.earned_at !== null).slice(0, 3);
    const hasAny = badges !== undefined && badges.length > 0 && own;
    body = (
      <>
        <EmptyState
          preview={
            <View style={styles.preview} aria-hidden testID={`${ROUTE}.empty.sample`}>
              <SampleBadge />
              <View style={styles.previewChips}>
                {sample.map((badge) => (
                  <BadgeChip key={badge.key} badge={badge} testID={`${ROUTE}.empty.sample.${badge.key}`} />
                ))}
              </View>
            </View>
          }
          title={own ? t('gift.badges.emptyOwnTitle') : t('gift.badges.emptyOther', { name: `@${username ?? ''}` })}
          body={own ? t('gift.badges.emptyOwnBody') : undefined}
          action={own ? { label: t('gift.badges.emptyOwnAction'), onPress: addVehicle, variant: 'secondary', size: 'm' } : undefined}
          testID={`${ROUTE}.empty`}
        />
        {hasAny && badges ? <BadgeRows groups={groupBadges(badges)} onOpen={setOpen} /> : null}
      </>
    );
  } else {
    body = (
      <>
        <View style={styles.intro}>
          {qaGiftActive() ? <SampleBadge testID={`${ROUTE}.sample`} /> : null}
          {own ? (
            <Text variant="headline" numeric testID={`${ROUTE}.count`}>
              {t('gift.badges.count', { earned: format.number(earned), total: format.number(badges.length) })}
            </Text>
          ) : null}
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.rules`}>
            {t('gift.badges.rules')}
          </Text>
        </View>
        <BadgeRows groups={groupBadges(own ? badges : publicBadges(badges))} onOpen={setOpen} />
      </>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="compact"
        title={own || !username ? t('gift.badges.title') : `${t('gift.badges.title')} · @${username}`}
        onBack={back}
        contentMaxWidth={column.headerWidth}
        contentAlign={column.headerAlign}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('gift.badges.offline')} />
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: inset }} testID={`${ROUTE}.scroll`}>
        <View style={[column.style, styles.content]}>{body}</View>
      </ScrollView>
      <BadgeSheet badge={open} onClose={() => setOpen(null)} testID={`${ROUTE}.badgeSheet`} />
    </Screen>
  );
}
