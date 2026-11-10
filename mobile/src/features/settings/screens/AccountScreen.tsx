import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Me } from '@/api/queries/auth';
import { breakableEmail } from '@/features/auth/forms';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { ListRow, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';

import { twoFactorEnabledOf } from '../account';
import { MemberGate } from '../components/MemberGate';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { RowGroup } from '@/ui/RowGroup';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET, ValueRow } from '../components/ValueRow';
import { SETTINGS_PATHS } from '../navigation';

const ROUTE = 'SET-02';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
  since: { paddingHorizontal: t.space[16] },
}));

function AccountSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.groups}>
        {[2, 3].map((rows) => (
          <View key={rows} style={styles.skeletonGroup}>
            <SkeletonText variant="labelS" width="25%" style={styles.skeletonLabel} />
            <SkeletonBlock height={size.row.withThumb * rows} corner="md" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

function AccountRows({ me }: { me: Me }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const twoFactor = twoFactorEnabledOf(me);
  return (
    <View style={styles.groups}>
      <RestrictionNotice routeId={ROUTE} />
      <RowGroup title={t('account.groupAccount')} testID={`${ROUTE}.account`}>
        {/* The address may be long; it takes the subtitle line, where it can wrap at "@" and dots. */}
        <ListRow
          icon="user"
          title={t('account.email')}
          subtitle={breakableEmail(me.email)}
          hyphenate={false}
          onPress={() => router.push('/settings/account/email')}
          inset={ROW_INSET}
          divider
          testID={`${ROUTE}.email`}
        />
        <ListRow
          icon="pencil-simple"
          title={t('account.username')}
          subtitle={me.username ? `@${me.username}` : t('account.noUsername')}
          hyphenate={false}
          onPress={() => router.push('/profile/edit')}
          inset={ROW_INSET}
          testID={`${ROUTE}.username`}
        />
      </RowGroup>
      <RowGroup title={t('groups.security')} testID={`${ROUTE}.security`}>
        <ListRow
          icon="lock-simple"
          title={t('rows.password')}
          onPress={() => router.push(SETTINGS_PATHS.password)}
          inset={ROW_INSET}
          divider
          testID={`${ROUTE}.password`}
        />
        {twoFactor === null ? (
          <ListRow
            icon="shield-check"
            title={t('rows.twoFactor')}
            onPress={() => router.push(SETTINGS_PATHS.twoFactor)}
            inset={ROW_INSET}
            divider
            testID={`${ROUTE}.twoFactor`}
          />
        ) : (
          <ValueRow
            icon="shield-check"
            title={t('rows.twoFactor')}
            value={t(twoFactor ? 'rows.on' : 'rows.off')}
            onPress={() => router.push(SETTINGS_PATHS.twoFactor)}
            divider
            testID={`${ROUTE}.twoFactor`}
          />
        )}
        <ListRow
          icon="device-mobile"
          title={t('rows.sessions')}
          onPress={() => router.push(SETTINGS_PATHS.sessions)}
          inset={ROW_INSET}
          testID={`${ROUTE}.sessions`}
        />
      </RowGroup>
      <Text variant="supporting" color="text.secondary" style={styles.since} testID={`${ROUTE}.since`}>
        {t('account.memberSince', { date: format.monthYear(new Date(me.member_since)) })}
      </Text>
    </View>
  );
}

/** The body of SET-02, also the detail beside the list on desktop SET-01. */
export function AccountBody() {
  return (
    <MemberGate routeId={ROUTE} returnTo="/settings/account" skeleton={<AccountSkeleton />}>
      {(me) => <AccountRows me={me} />}
    </MemberGate>
  );
}

/** SET-02 /settings/account: the address and the username, and the way to the security pages. */
export function AccountScreen() {
  const { t } = useTranslation('settings');
  return (
    <SettingsPage routeId={ROUTE} title={t('account.title')} fallback="/settings" offlineLabel={t('offlineForm')} section="account">
      <AccountBody />
    </SettingsPage>
  );
}
