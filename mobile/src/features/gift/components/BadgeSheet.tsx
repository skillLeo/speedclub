import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Badge } from '@/api/queries/badges';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[12], paddingBottom: t.space[8] },
  meta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.overlay,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
}));

/** "Gold · Spotting": tier and category of a badge as the sheet and the list rows label them. */
export function badgeMeta(t: (key: string) => string, badge: Badge): string[] {
  return [badge.tier ? t(`gift.badges.tier.${badge.tier}`) : null, t(`gift.badges.category.${badge.category ?? 'other'}`)].filter(
    (part): part is string => part !== null,
  );
}

/**
 * Badge detail (contract §2, §8): name as the sheet title, tier and category, the description, and when it was earned; a hidden
 * badge not earned yet shows "???" and its hint, nothing else. Only the own profile ever has such a badge to open.
 */
export function BadgeSheet({ badge, onClose, testID }: { badge: Badge | null; onClose: () => void; testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const hidden = badge?.hidden === true;
  return (
    <Sheet
      visible={badge !== null}
      onClose={onClose}
      title={badge ? (hidden ? t('gift.badges.hiddenName') : (badge.name ?? '')) : undefined}
      label={hidden ? t('gift.badges.hiddenLabel') : undefined}
      narrow
      footer={<Button label={t('gift.badges.close')} variant="secondary" size="l" fullWidth onPress={onClose} testID={`${testID}.close`} />}
      testID={testID}
    >
      {badge ? (
        <View style={styles.body}>
          {hidden ? null : (
            <View style={styles.meta}>
              {badgeMeta(t, badge).map((part) => (
                <View key={part} style={styles.tag}>
                  <Text variant="labelBadge" color="text.secondary" hyphenate={false}>
                    {part}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {hidden ? (
            <Text variant="body" testID={`${testID}.description`}>
              {t('gift.badges.hiddenBody')}
            </Text>
          ) : badge.description ? (
            <Text variant="body" testID={`${testID}.description`}>
              {badge.description}
            </Text>
          ) : null}
          {hidden && badge.hint ? (
            <Text variant="callout" color="text.secondary" testID={`${testID}.hint`}>
              {t('gift.badges.hint', { hint: badge.hint })}
            </Text>
          ) : null}
          <Text variant="callout" color="text.secondary" numeric testID={`${testID}.earned`}>
            {badge.earned_at ? t('gift.badges.earnedOn', { date: format.longDate(new Date(badge.earned_at)) }) : t('gift.badges.notYet')}
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}
