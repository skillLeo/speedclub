import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { orderBadges, publicBadges, useMemberBadges, useMyBadges, type Badge } from '@/api/queries/badges';
import { foundingNumberOf, foundingNumberText, publicLevelOf, useMyLevel, type PublicLevel } from '@/api/queries/level';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { Chip } from '@/ui/Chip';
import { Icon } from '@/ui/icons/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { SectionHeader } from '@/ui/SectionHeader';
import { Skeleton, SkeletonBlock } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { QA_FOUNDING_NUMBER, QA_MEMBER_FOUNDING_NUMBER, QA_MEMBER_LEVEL, qaGiftActive } from '../qaGift';
import { BadgeSheet } from './BadgeSheet';
import { LevelSheet } from './LevelSheet';

/** How many badges the profile row shows before "Alle". */
export const BADGE_ROW_MAX = 6;

const useStyles = createStyles((t) => ({
  levelVisual: { borderRadius: t.radius.xs },
  levelRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  levelText: { flexShrink: 1 },
  badges: { gap: t.space[8], marginTop: t.space[16] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  trailing: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
}));

/** The route of the badge list: the own one under Profil, another member's under their page. */
export function badgesPath(username: string | null, own: boolean) {
  return own ? ('/profile/badges' as const) : { pathname: '/u/[username]/badges' as const, params: { username: username ?? '' } };
}

/**
 * "Lvl 4 · Parts Hunter" next to the @username (contract §1, §8): quiet, callout in the secondary tone, the title always the server's.
 * Client round 2: every level line is a button with a chevron (a 44 target around the line, the pressed tone of PressableScale) that
 * opens the level sheet: the own one with XP, the next level and what follows; another member's with their place on the ladder.
 */
/** Where the level number goes in the translated line, to split it there (no character a title or a translation contains). */
const LEVEL_SLOT = '\u0000';

export function LevelLine({ level, own, routeId, name }: { level: PublicLevel; own: boolean; routeId: string; name?: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const number = format.number(level.level);
  const text = t('gift.level.line', { level: number, title: level.title });
  // R4DQ-45: tabular figures on the level number alone. On the whole line Inter's `tnum` gives a title's hyphen a figure's width
  // ("Schrauber-Azubi" read "Schrauber - Azubi"). The line is split around the number, wherever the language puts it.
  const [before = '', after = ''] = t('gift.level.line', { level: LEVEL_SLOT, title: level.title }).split(LEVEL_SLOT);
  return (
    <>
      <PressableScale
        role="button"
        // The visible line leads the name (WCAG 2.5.3, axe label-content-name-mismatch), the hint follows.
        aria-label={t(own ? 'gift.level.openLabel' : 'gift.level.memberOpenLabel', { line: text })}
        onPress={() => setOpen(true)}
        visualHeight={size.icon.m}
        contentStyle={styles.levelVisual}
        testID={`${routeId}.level`}
      >
        <View style={styles.levelRow}>
          <Text variant="callout" color="text.secondary" hyphenate={false} style={styles.levelText} testID={`${routeId}.level.text`}>
            {before}
            {/* A nested Text resets to its variant, so the number keeps the line's look. */}
            <Text variant="callout" color="text.secondary" numeric hyphenate={false} testID={`${routeId}.level.number`}>
              {number}
            </Text>
            {after}
          </Text>
          <Icon name="caret-right" size={size.icon.s} color="text.secondary" />
        </View>
      </PressableScale>
      <LevelSheet
        visible={open}
        onClose={() => setOpen(false)}
        member={own ? undefined : { level, name: name ?? '' }}
        testID={`${routeId}.levelSheet`}
      />
    </>
  );
}

/** "Founding Member" with its four-digit number (contract §4): one of the first 1,000 production accounts. Tabular, public. */
export function FoundingLine({ number, routeId }: { number: number; routeId: string }) {
  const { t } = useTranslation('profile');
  const text = foundingNumberText(number);
  return (
    <Text variant="caption" color="text.tertiary" numeric aria-label={t('gift.foundingLabel', { number })} testID={`${routeId}.founding`}>
      {t('gift.founding', { number: text })}
    </Text>
  );
}

function badgeChipLabel(t: (key: string, options?: Record<string, unknown>) => string, badge: Badge): { label: string; a11y: string } {
  if (badge.hidden) {
    const label = t('gift.badges.hiddenName');
    return { label, a11y: `${label}, ${t('gift.badges.hiddenLabel')}` };
  }
  const name = badge.name ?? '';
  return { label: name, a11y: t(badge.earned_at ? 'gift.badges.earnedLabel' : 'gift.badges.lockedLabel', { name }) };
}

/** One badge as a chip: medal for earned, lock for one still to earn, question mark for a hidden one. */
export function BadgeChip({ badge, onPress, testID }: { badge: Badge; onPress?: () => void; testID: string }) {
  const { t } = useTranslation('profile');
  const { label, a11y } = badgeChipLabel(t, badge);
  return (
    <Chip
      label={label}
      icon={badge.hidden ? 'question' : badge.earned_at ? 'medal' : 'lock-simple'}
      accessibilityLabel={a11y}
      onPress={onPress}
      testID={testID}
    />
  );
}

/** The row's skeleton: the header line and one line of chips. */
function BadgeRowSkeleton({ routeId }: { routeId: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${routeId}.badges.skeleton`}>
      <View style={styles.badges}>
        <SkeletonBlock width="30%" height={size.icon.m} corner="xs" />
        <View style={styles.chips}>
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} width={size.touchMin * 3} height={size.chip} corner="full" />
          ))}
        </View>
      </View>
    </Skeleton>
  );
}

export type BadgeRowViewProps = {
  badges: readonly Badge[];
  own: boolean;
  /** The member's name for the list route (another member). */
  username: string | null;
  routeId: string;
};

/**
 * The badge row of a profile (contract §2, §8): only earned badges, newest first, at most six, and "Alle" into the list
 * (DQ-P5G-26: a locked badge in the same outline chip read as earned; the list BDG-01 explains the locked and hidden ones). The own
 * profile adds "4 von 9" and keeps the row with "Alle" before the first badge; another member's has no row without one. A chip
 * opens the detail sheet.
 */
export function BadgeRowView({ badges, own, username, routeId }: BadgeRowViewProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState<Badge | null>(null);
  const sample = qaGiftActive();
  const shown = own ? orderBadges(badges.filter((badge) => badge.earned_at !== null)) : publicBadges(badges);
  if (shown.length === 0 && !own) return null;
  const earned = badges.filter((badge) => badge.earned_at !== null).length;
  return (
    <View style={styles.badges} testID={`${routeId}.badges`}>
      <SectionHeader
        title={t('gift.badges.title')}
        level={3}
        trailing={
          own || sample ? (
            <View style={styles.trailing}>
              {/* QA set only (never in production): the bundled badges are samples and say so. */}
              {sample ? <SampleBadge testID={`${routeId}.badges.sample`} /> : null}
              {own ? (
                <Text variant="caption" color="text.tertiary" numeric testID={`${routeId}.badges.count`}>
                  {t('gift.badges.count', { earned: format.number(earned), total: format.number(badges.length) })}
                </Text>
              ) : null}
            </View>
          ) : undefined
        }
      />
      <View style={styles.chips} role="list" testID={`${routeId}.badges.list`}>
        {shown.slice(0, BADGE_ROW_MAX).map((badge) => (
          <View key={badge.key} role="listitem">
            <BadgeChip badge={badge} onPress={() => setOpen(badge)} testID={`${routeId}.badge.${badge.key}`} />
          </View>
        ))}
        {/* A list holds only list items (axe aria-required-children), so "Alle" is the row's last item. */}
        <View role="listitem">
          <Chip
            label={t('gift.badges.all')}
            icon="caret-right"
            accessibilityLabel={t('gift.badges.allLabel')}
            onPress={() => router.push(badgesPath(username, own))}
            testID={`${routeId}.badges.all`}
          />
        </View>
      </View>
      <BadgeSheet badge={open} onClose={() => setOpen(null)} testID={`${routeId}.badgeSheet`} />
    </View>
  );
}

/** PROF-01: the own badges (`GET me/badges`). Quiet while loading the first time; a failed read leaves the row out. */
export function MyBadgeRow({ routeId, username }: { routeId: string; username: string | null }) {
  const query = useMyBadges();
  if (query.isPending && query.fetchStatus === 'fetching') return <BadgeRowSkeleton routeId={routeId} />;
  if (!query.data) return null;
  return <BadgeRowView badges={query.data} own username={username} routeId={routeId} />;
}

/** PROF-02: another member's earned badges (`GET users/{username}/badges`). */
export function MemberBadgeRow({ routeId, username }: { routeId: string; username: string }) {
  const query = useMemberBadges(username);
  if (query.isPending && query.fetchStatus === 'fetching') return <BadgeRowSkeleton routeId={routeId} />;
  if (!query.data) return null;
  return <BadgeRowView badges={query.data} own={false} username={username} routeId={routeId} />;
}

export type ProfileGiftSlots = { level?: ReactNode; founding?: ReactNode; badges?: ReactNode };

/**
 * PROF-01: the own level (`GET me/level`, else the `level` the profile resource carries), the founding line and the badge row. A
 * member without a level yet (or before M5.9d) gets no line: the app never makes one up.
 */
export function useOwnProfileGift(profile: unknown, username: string | null, routeId: string): ProfileGiftSlots {
  const query = useMyLevel();
  const level = query.data ? { level: query.data.level, title: query.data.title } : publicLevelOf(profile);
  const founding = foundingNumberOf(profile) ?? (qaGiftActive() ? QA_FOUNDING_NUMBER : null);
  return {
    level: level ? <LevelLine level={level} own routeId={routeId} /> : undefined,
    founding: founding !== null ? <FoundingLine number={founding} routeId={routeId} /> : undefined,
    badges: <MyBadgeRow routeId={routeId} username={username} />,
  };
}

/** PROF-02: what another member's profile resource carries (`level`, `founding_number`) and their earned badges. */
export function memberProfileGift(profile: unknown, username: string, routeId: string): ProfileGiftSlots {
  const sample = qaGiftActive();
  const level = publicLevelOf(profile) ?? (sample ? QA_MEMBER_LEVEL : null);
  // A founding number is unique: the QA member carries another one than the signed-in QA profile (DQ-P5G-25).
  const founding = foundingNumberOf(profile) ?? (sample ? QA_MEMBER_FOUNDING_NUMBER : null);
  return {
    level: level ? <LevelLine level={level} own={false} routeId={routeId} name={`@${username}`} /> : undefined,
    founding: founding !== null ? <FoundingLine number={founding} routeId={routeId} /> : undefined,
    badges: <MemberBadgeRow routeId={routeId} username={username} />,
  };
}
