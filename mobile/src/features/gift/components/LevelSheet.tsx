import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { orderBadges, useMyBadges, type Badge } from '@/api/queries/badges';
import { DEFAULT_XP_RULES, nextStep, useMyLevel, type LevelStep, type MyLevel, type PublicLevel, type XpRule } from '@/api/queries/level';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { MaintenanceRing } from '@/ui/MaintenanceCard';
import { useStacksAtFontScale } from '@/ui/rowParts';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import '../qaGift';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24], paddingBottom: t.space[8] },
  hero: { alignItems: 'center', flexDirection: 'row', gap: t.space[20] },
  heroText: { flex: 1, gap: t.space[4], minWidth: 0 },
  today: { gap: t.space[4] },
  rules: { gap: t.space[12] },
  // DQ-P5G-27 / DQ-P5-202: the trailing column holds only the points ("+2 XP", short, tnum); a daily cap is a caption line under
  // the rule text, so the rule always keeps the wide column and is never squeezed by "+2 XP · höchstens 20 XP am Tag".
  rule: { alignItems: 'baseline', columnGap: t.space[12], flexDirection: 'row', justifyContent: 'space-between' },
  ruleText: { flexBasis: 0, flexGrow: 1, flexShrink: 1, gap: t.space[2], minWidth: 0 },
  ruleValue: { flexShrink: 0, textAlign: 'right' },
  // Large text (as grouped rows, useStacksAtFontScale): the points go under the rule (and its cap line), so the rule keeps the full
  // width and no word breaks inside itself (gate run 1, PROF-01-level fs2).
  ruleStacked: { alignItems: 'flex-start', flexDirection: 'column', rowGap: t.space[2] },
  ruleTextStacked: { alignSelf: 'stretch', flexBasis: 'auto', flexGrow: 0 },
  ruleValueStacked: { textAlign: 'left' },
  section: { gap: t.space[12] },
  // R7-3: a badge to earn is a column (name, then how to get it) inside the list's column. `ruleText` is made for a row (flexBasis 0,
  // so the rule shares the line with its points); in a column that basis is the height, the box collapsed to nothing and the next
  // badge's name was set over this one's description ("text on top of each other"). Its own lines take the height they need.
  badge: { gap: t.space[2], minWidth: 0 },
  // The member's own line is the only one in the primary tone; reached levels step back.
  memberHero: { gap: t.space[4] },
}));

/** How many badges still to earn the sheet names before "Alle Abzeichen" (the list BDG-01 holds them all). */
export const LEVEL_SHEET_BADGES = 3;

/** Badges still to earn, in the admin's order, the visible ones before the hidden ones (orderBadges), at most `max`. */
export function badgesToEarn(badges: readonly Badge[] | undefined, max: number = LEVEL_SHEET_BADGES): Badge[] {
  if (!badges) return [];
  return orderBadges(badges.filter((badge) => badge.earned_at === null)).slice(0, max);
}

type LadderMark = { level: number; label: string };

/**
 * Client round 2: the whole ladder, every title with the XP where it starts. The marked level (yours, or the member's you look at)
 * carries its line; the next one says how much is left when the XP are yours. Levels bring titles only, the note says so.
 */
function LevelLadder({ ladder, mark, xp, testID }: { ladder: readonly LevelStep[]; mark: LadderMark; xp: number | null; testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const stacked = useStacksAtFontScale();
  return (
    <View style={styles.section} testID={`${testID}.ladder`}>
      <Text variant="calloutStrong" role="heading" aria-level={3}>
        {t('gift.level.ladderTitle')}
      </Text>
      <View role="list" style={styles.rules}>
        {ladder.map((step, index) => {
          const here = step.level === mark.level;
          const next = xp !== null && step.level === mark.level + 1;
          const reached = step.level < mark.level;
          return (
            <View key={step.level} role="listitem" style={styles.rules}>
              {index > 0 ? <Hairline /> : null}
              <View style={[styles.rule, stacked && styles.ruleStacked]} testID={`${testID}.ladder.${step.level}`}>
                <View style={[styles.ruleText, stacked && styles.ruleTextStacked]}>
                  {/* No tnum here: it widens the hyphen of a title ("Garagen-Stammgast"); the numbers that change sit on the right. */}
                  <Text variant={here ? 'calloutStrong' : 'callout'} color={reached ? 'text.secondary' : 'text.primary'}>
                    {t('gift.level.line', { level: format.number(step.level), title: step.title })}
                  </Text>
                  {here ? (
                    <Text variant="caption" color="text.secondary" testID={`${testID}.ladder.here`}>
                      {mark.label}
                    </Text>
                  ) : null}
                  {next ? (
                    <Text variant="caption" color="text.secondary" numeric testID={`${testID}.ladder.left`}>
                      {t('gift.level.ladderLeft', { left: format.number(Math.max(0, step.from_xp - (xp ?? 0))) })}
                    </Text>
                  ) : null}
                </View>
                <Text
                  variant="callout"
                  color="text.secondary"
                  numeric
                  hyphenate={false}
                  style={[styles.ruleValue, stacked && styles.ruleValueStacked]}
                >
                  {t('gift.level.ladderFrom', { xp: format.number(step.from_xp) })}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text variant="callout" color="text.secondary" testID={`${testID}.ladderNote`}>
        {t('gift.level.ladderNote')}
      </Text>
    </View>
  );
}

/** Client round 2: the next badges to earn (name and how, or "???" with the hint), and the way into the full list. */
function BadgesToEarn({ badges, onAll, testID }: { badges: readonly Badge[]; onAll: () => void; testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  if (badges.length === 0) return null;
  return (
    <View style={styles.section} testID={`${testID}.badges`}>
      <Text variant="calloutStrong" role="heading" aria-level={3}>
        {t('gift.level.badgesTitle')}
      </Text>
      <View role="list" style={styles.rules}>
        {badges.map((badge, index) => (
          <View key={badge.key} role="listitem" style={styles.rules}>
            {index > 0 ? <Hairline /> : null}
            <View style={styles.badge} testID={`${testID}.badge.${badge.key}`}>
              <Text variant="callout">{badge.hidden ? t('gift.badges.hiddenName') : (badge.name ?? '')}</Text>
              {(badge.hidden ? badge.hint : badge.description) ? (
                <Text variant="caption" color="text.secondary">
                  {badge.hidden ? badge.hint : badge.description}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
      <Button
        label={t('gift.level.badgesAll')}
        variant="tertiary"
        size="m"
        role="link"
        flush="start"
        onPress={onAll}
        testID={`${testID}.badgesAll`}
      />
    </View>
  );
}

/** Rules for features this build does not run yet are left out (09 §7.15: never a dead promise). */
const RULE_FLAGS: Readonly<Record<string, string>> = { forum_solution: 'forum', helpful_received: 'forum', event_checkin: 'events.checkin' };

/** The rules "Wie du XP sammelst" lists: the server's when it sends them, else the contract defaults whose feature is on. */
export function visibleXpRules(level: Pick<MyLevel, 'rules'> | undefined, flags: Readonly<Record<string, boolean>>): readonly XpRule[] {
  if (level?.rules && level.rules.length > 0) return level.rules;
  return DEFAULT_XP_RULES.filter((rule) => {
    const flag = RULE_FLAGS[rule.type];
    return flag === undefined || flags[flag] === true;
  });
}

function LevelSkeleton({ testID }: { testID: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${testID}.skeleton`}>
      <View style={styles.body}>
        <View style={styles.hero}>
          <SkeletonBlock width={size.avatar.xl} height={size.avatar.xl} corner="full" />
          <View style={styles.heroText}>
            <SkeletonText variant="headline" width="60%" />
            <SkeletonText variant="callout" width="40%" />
          </View>
        </View>
        <SkeletonText variant="callout" lines={2} />
        <SkeletonText variant="callout" lines={5} />
      </View>
    </Skeleton>
  );
}

export type LevelSheetProps = {
  visible: boolean;
  onClose: () => void;
  testID: string;
  /**
   * Another member's level (PROF-02): their title and place on the ladder, how XP are earned, never their XP (only the member sees
   * those). Without it the sheet is the signed-in member's own (`GET me/level`).
   */
  member?: { level: PublicLevel; name: string };
};

/**
 * PROF-01 level sheet (contract §1, §8): the progress ring with the level numeral (MaintenanceRing: native sweeps it in on
 * spring.default, reduced motion and the web show the final arc), XP toward the next level with its title, today's XP against the
 * cap of 200, the whole ladder (client round 2: what comes next), the next badges to earn, and "Wie du XP sammelst" with the fixed
 * rules and the line that likes, posts and signing in earn nothing. PROF-02 opens it for another member's level line (`member`).
 */
export function LevelSheet({ visible, onClose, testID, member }: LevelSheetProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const router = useRouter();
  // The ladder is the same for everyone: another member's sheet reads it from the viewer's own level (signed in only).
  const query = useMyLevel(visible);
  const badgesQuery = useMyBadges(visible && !member);
  const forum = useFlag('forum');
  const checkin = useFlag('events.checkin');
  const level = query.data ?? undefined;
  const rules = visibleXpRules(level, { forum, 'events.checkin': checkin });
  const stacked = useStacksAtFontScale();
  const toEarn = badgesToEarn(badgesQuery.data);
  const openBadges = () => {
    onClose();
    router.push('/profile/badges');
  };

  const rulesBlock = (
    <View style={styles.rules}>
      <Text variant="calloutStrong" role="heading" aria-level={3}>
        {t(member ? 'gift.level.memberRulesTitle' : 'gift.level.rulesTitle')}
      </Text>
      <View role="list" style={styles.rules} testID={`${testID}.rules`}>
        {rules.map((rule, index) => (
          <View key={rule.type} role="listitem" style={styles.rules}>
            {index > 0 ? <Hairline /> : null}
            <View style={[styles.rule, stacked && styles.ruleStacked]} testID={`${testID}.rule.${rule.type}`}>
              <View style={[styles.ruleText, stacked && styles.ruleTextStacked]}>
                <Text variant="callout">{t(`gift.level.rules.${rule.type}`, { defaultValue: rule.type })}</Text>
                {rule.daily_max === null ? null : (
                  <Text variant="caption" color="text.secondary" numeric testID={`${testID}.rule.${rule.type}.cap`}>
                    {t('gift.level.perDay', { max: format.number(rule.daily_max) })}
                  </Text>
                )}
              </View>
              <Text
                variant="callout"
                color="text.secondary"
                numeric
                hyphenate={false}
                style={[styles.ruleValue, stacked && styles.ruleValueStacked]}
                testID={`${testID}.rule.${rule.type}.points`}
              >
                {t('gift.level.points', { points: format.number(rule.points) })}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text variant="callout" color="text.secondary" testID={`${testID}.never`}>
        {t('gift.level.never')}
      </Text>
    </View>
  );

  if (member) {
    const ladder = level?.ladder ?? [];
    const content = (
      <View style={styles.body}>
        <View style={styles.memberHero} testID={`${testID}.hero`}>
          <Text variant="headline" numeric testID={`${testID}.title`}>
            {t('gift.level.line', { level: format.number(member.level.level), title: member.level.title })}
          </Text>
          <Text variant="callout" color="text.secondary">
            {t('gift.level.memberIntro')}
          </Text>
        </View>
        {/* Signed in, the ladder places the member; a guest (or a failed read) still learns how levels work from the rules. */}
        {ladder.length > 0 ? (
          <LevelLadder ladder={ladder} mark={{ level: member.level.level, label: t('gift.level.ladderMember', { name: member.name }) }} xp={null} testID={testID} />
        ) : query.isPending && query.fetchStatus === 'fetching' ? (
          <Skeleton testID={`${testID}.ladder.skeleton`}>
            <SkeletonText variant="callout" lines={5} />
          </Skeleton>
        ) : null}
        {rulesBlock}
      </View>
    );
    return (
      <Sheet
        visible={visible}
        onClose={onClose}
        title={t('gift.level.memberSheetTitle', { name: member.name })}
        footer={<Button label={t('gift.level.close')} variant="secondary" size="l" fullWidth onPress={onClose} testID={`${testID}.close`} />}
        testID={testID}
      >
        {content}
      </Sheet>
    );
  }

  let content;
  if (level) {
    const top = level.next_level_xp === null;
    const next = nextStep(level.ladder, level.level);
    const percent = Math.round(level.progress * 100);
    content = (
      <View style={styles.body}>
        <View style={styles.hero} testID={`${testID}.hero`}>
          <View
            role="img"
            aria-label={
              top
                ? t('gift.level.ringLabelTop', { level: level.level })
                : t('gift.level.ringLabel', { level: level.level, percent, next: level.level + 1 })
            }
          >
            <MaintenanceRing progress={level.progress} tone="ok" box={size.avatar.xl} testID={`${testID}.ring`}>
              <Text variant="heroNumeralS" numeric>
                {format.number(level.level)}
              </Text>
            </MaintenanceRing>
          </View>
          <View style={styles.heroText}>
            <Text variant="headline" testID={`${testID}.title`}>
              {t('gift.level.line', { level: level.level, title: level.title })}
            </Text>
            <Text variant="callout" color="text.secondary" numeric testID={`${testID}.xp`}>
              {top
                ? t('gift.level.xpTop', { xp: format.number(level.xp) })
                : t('gift.level.xp', { xp: format.number(level.xp), next: format.number(level.next_level_xp ?? 0) })}
            </Text>
            <Text variant="caption" color="text.tertiary" numeric testID={`${testID}.toNext`}>
              {top
                ? t('gift.level.top')
                : next
                  ? t('gift.level.toNextNamed', { left: format.number(Math.max(0, (level.next_level_xp ?? 0) - level.xp)), next: level.level + 1, title: next.title })
                  : t('gift.level.toNext', { left: format.number(Math.max(0, (level.next_level_xp ?? 0) - level.xp)), next: level.level + 1 })}
            </Text>
          </View>
        </View>
        <View style={styles.today} testID={`${testID}.today`}>
          <Text variant="calloutStrong" numeric>
            {t('gift.level.today', { earned: format.number(level.today.earned), cap: format.number(level.today.cap) })}
          </Text>
          <Text variant="callout" color="text.secondary" numeric>
            {t('gift.level.todayHint', { cap: format.number(level.today.cap) })}
          </Text>
        </View>
        {level.ladder.length > 0 ? (
          <LevelLadder ladder={level.ladder} mark={{ level: level.level, label: t('gift.level.ladderHere') }} xp={level.xp} testID={testID} />
        ) : null}
        <BadgesToEarn badges={toEarn} onAll={openBadges} testID={testID} />
        {rulesBlock}
      </View>
    );
  } else if (query.isError || (query.isSuccess && !query.data)) {
    content = <ErrorState title={t('gift.level.errorTitle')} onRetry={() => void query.refetch()} retrying={query.isFetching} testID={`${testID}.error`} />;
  } else {
    content = <LevelSkeleton testID={testID} />;
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('gift.level.sheetTitle')}
      footer={<Button label={t('gift.level.close')} variant="secondary" size="l" fullWidth onPress={onClose} testID={`${testID}.close`} />}
      testID={testID}
    >
      {content}
    </Sheet>
  );
}
