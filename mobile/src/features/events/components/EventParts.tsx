import '@/features/events/i18n';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { EVENT_RULES, type EventRule } from '@/api/queries/events';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { createStyles } from '@/theme';
import { Button, Icon, Text } from '@/ui';

import type { ReviewNotice } from '../model';

const useStyles = createStyles((t) => ({
  section: { gap: t.space[12] },
  notice: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[8],
    padding: t.space[16],
  },
  noticeHead: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  rules: { gap: t.space[12] },
  rule: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  ruleText: { flex: 1 },
  action: { alignSelf: 'flex-start' },
}));

/** A publishing restriction or a read-only view: what the member cannot do here, and that browsing still works. */
export function RestrictionLine({ message, testID }: { message: string; testID: string }) {
  return <FormNotice message={message} tone="info" testID={testID} />;
}

/** A titled block of EVT-02 (Beschreibung, Regeln, Teilnehmende): `callout.strong` header, 12 to its content. */
export function EventSection({
  title,
  trailing,
  children,
  style,
  testID,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.section, style]} testID={testID}>
      <View style={styles.noticeHead}>
        <Text
          variant="calloutStrong"
          color="text.secondary"
          role="heading"
          aria-level={2}
          style={styles.ruleText}
        >
          {title}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

const NOTICE_ICON = {
  draft: 'pencil-simple',
  pending: 'clock',
  rejected: 'warning',
  cancelled: 'prohibit',
} as const;

/**
 * The organiser's review state (ADR-439) and a cancelled event's reason, on a surface-1 block above the details: pending is frozen
 * and says so, a rejection names the team's reason and leads back into the editor. Never red: it is not a destructive act.
 */
export function ReviewBanner({
  notice,
  byStaff = false,
  organiser,
  onAction,
  testID,
}: {
  notice: ReviewNotice;
  byStaff?: boolean;
  organiser: boolean;
  onAction?: () => void;
  testID: string;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const title =
    notice.kind === 'draft'
      ? t('review.draftTitle')
      : notice.kind === 'pending'
        ? t('review.pendingTitle')
        : notice.kind === 'rejected'
          ? t('review.rejectedTitle')
          : t('detail.cancelledTitle');
  const body =
    notice.kind === 'draft'
      ? t('review.draftBody')
      : notice.kind === 'pending'
        ? t('review.pendingBody')
        : notice.kind === 'rejected'
          ? t('review.rejectedBody')
          : byStaff
            ? t('detail.cancelledByStaff')
            : t('detail.cancelledBy');
  const reason = notice.reason
    ? notice.kind === 'cancelled'
      ? t('detail.cancelledReason', { reason: notice.reason })
      : t('review.rejectedReason', { reason: notice.reason })
    : null;
  const action =
    organiser && onAction
      ? notice.kind === 'draft'
        ? t('review.draftAction')
        : notice.kind === 'rejected'
          ? t('review.rejectedAction')
          : null
      : null;
  return (
    <View style={styles.notice} role="status" testID={testID}>
      <View style={styles.noticeHead}>
        <Icon name={NOTICE_ICON[notice.kind]} size={20} color="text.primary" />
        <Text variant="headline" testID={`${testID}.title`}>
          {title}
        </Text>
      </View>
      <Text variant="body" color="text.secondary">
        {body}
      </Text>
      {reason ? (
        <Text variant="body" testID={`${testID}.reason`}>
          {reason}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={action}
          variant="secondary"
          size="m"
          onPress={onAction}
          style={styles.action}
          testID={`${testID}.action`}
        />
      ) : null}
    </View>
  );
}

/**
 * "Regeln" (09 §7.10): the checklist the organiser accepted, in the order of the guidelines; "Nur legal" is always first. DQ-1119 b:
 * under the one section header the two groups are `caption` labels ("Community", "Organisator"), never a second header.
 */
export function RulesList({
  rules,
  organiserRules,
  testID,
}: {
  rules: readonly unknown[];
  organiserRules: string | null;
  testID: string;
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const accepted = EVENT_RULES.filter((rule) => rules.includes(rule) || rule === 'legal_only');
  return (
    <View style={styles.rules} testID={testID}>
      <Text variant="caption" color="text.secondary">
        {t('detail.communityRules')}
      </Text>
      {accepted.map((rule: EventRule) => (
        <View key={rule} style={styles.rule} testID={`${testID}.${rule}`}>
          <Icon name="check" size={20} color="text.secondary" />
          <Text variant="body" style={styles.ruleText}>
            {t(`editor.rule.${rule}`)}
          </Text>
        </View>
      ))}
      {organiserRules ? (
        <>
          <Text variant="caption" color="text.secondary">
            {t('detail.organiserRules')}
          </Text>
          <Text variant="body" testID={`${testID}.organiser`}>
            {organiserRules}
          </Text>
        </>
      ) : null}
    </View>
  );
}
