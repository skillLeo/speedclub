import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { MAINTENANCE_FLAG } from '@/api/queries/maintenance';
import { useMemberSettings, useUpdateMemberSettings } from '@/api/queries/settings';
import { SignInState } from '@/features/garage/components/frames';
import { SwitchRow } from '@/features/settings/components/SettingRows';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Button, Chip, EmptyState, ErrorState, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';
import { RowGroup } from '@/ui/RowGroup';

import { LEAD_OPTIONS, MAX_LEADS } from '../model';

const ROUTE = 'SET-23';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  chipsBox: { gap: t.space[12], padding: t.space[16] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  footer: { alignItems: 'flex-start', gap: t.space[8] },
  skeletonGroup: { gap: t.space[8] },
}));

/**
 * SET-23 = MNT-03 /settings/reminders "Garage & Erinnerungen" (09 §7.9, §7.12, ADR-441): the lead times every new HU/AU item
 * starts with (at most three, longest first; 30/14/1 by default) and the switches for tyre change (O bis O), insurance (Stichtag
 * 30.11.) and service-type reminders. Whether they come by push or e-mail is SET-09's "Fälligkeiten". Every change saves at once
 * (optimistic, back on failure), like every settings switch.
 */
export function ReminderDefaultsScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const readOnly = useViewAsReadOnly();
  const flag = useFlag(MAINTENANCE_FLAG);
  const status = useSessionStore((state) => state.status);
  const settings = useMemberSettings();
  const update = useUpdateMemberSettings();
  const [full, setFull] = useState(false);
  const prefs = settings.data?.maintenance;
  const disabled = !online || readOnly;

  const patch = (maintenance: Partial<NonNullable<typeof prefs>>) =>
    update.mutate({ maintenance }, { onError: () => toast(t('maintenance.defaults.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }) });

  const toggleLead = (days: number) => {
    if (!prefs) return;
    const current = prefs.hu_au_lead_days;
    if (current.includes(days)) {
      setFull(false);
      patch({ hu_au_lead_days: current.filter((entry) => entry !== days) });
      return;
    }
    if (current.length >= MAX_LEADS) {
      haptics.warning();
      setFull(true);
      return;
    }
    setFull(false);
    patch({ hu_au_lead_days: [...current, days].sort((a, b) => b - a) });
  };

  let body: ReactNode;
  if (status === 'guest') body = <SignInState routeId={ROUTE} returnTo="/settings/reminders" />;
  else if (!flag && qaState === 'default') body = <EmptyState icon="hu-plakette" title={t('maintenance.unavailableTitle')} body={t('maintenance.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  else if (qaState === 'loading' || status === 'loading' || (!prefs && settings.isPending && settings.fetchStatus !== 'paused')) {
    body = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.groups}>
          {[2, 3].map((rows) => (
            <View key={rows} style={styles.skeletonGroup}>
              <SkeletonText variant="calloutStrong" width="30%" />
              <SkeletonBlock height={size.row.withThumb * rows} corner="md" />
            </View>
          ))}
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || !prefs) {
    body = <ErrorState title={t('maintenance.defaults.errorTitle')} onRetry={() => void settings.refetch()} retrying={settings.isFetching} testID={`${ROUTE}.error`} />;
  } else {
    body = (
      <View style={styles.groups}>
        <RowGroup title={t('maintenance.defaults.huGroup')} testID={`${ROUTE}.hu`}>
          <View style={styles.chipsBox}>
            <View style={styles.chips} role="group" aria-label={t('maintenance.editor.leadTitle')}>
              {LEAD_OPTIONS.map((days) => (
                <Chip
                  key={days}
                  label={days === 0 ? t('maintenance.editor.leadSameDay') : t('maintenance.editor.lead', { count: days })}
                  selected={prefs.hu_au_lead_days.includes(days)}
                  selectionRole="checkbox"
                  disabled={disabled}
                  onPress={() => toggleLead(days)}
                  testID={`${ROUTE}.lead.${days}`}
                />
              ))}
            </View>
            <Text variant="caption" color={full ? 'accent.fg' : 'text.secondary'} role={full ? 'alert' : undefined} testID={`${ROUTE}.huHelper`}>
              {full ? t('maintenance.defaults.leadsMax') : t('maintenance.defaults.huHelper')}
            </Text>
          </View>
        </RowGroup>
        <RowGroup title={t('maintenance.defaults.typesGroup')} testID={`${ROUTE}.types`}>
          <SwitchRow
            title={t('maintenance.defaults.tyres')}
            helper={t('maintenance.defaults.tyresHelper')}
            value={prefs.tyre_reminders}
            onValueChange={(next) => patch({ tyre_reminders: next })}
            disabled={disabled}
            divider
            testID={`${ROUTE}.tyres`}
          />
          <SwitchRow
            title={t('maintenance.defaults.insurance')}
            helper={t('maintenance.defaults.insuranceHelper')}
            hyphenate={false}
            value={prefs.insurance_reminder}
            onValueChange={(next) => patch({ insurance_reminder: next })}
            disabled={disabled}
            divider
            testID={`${ROUTE}.insurance`}
          />
          <SwitchRow
            title={t('maintenance.defaults.service')}
            helper={t('maintenance.defaults.serviceHelper')}
            value={prefs.service_reminders}
            onValueChange={(next) => patch({ service_reminders: next })}
            disabled={disabled}
            testID={`${ROUTE}.service`}
          />
        </RowGroup>
        <View style={styles.footer}>
          <Text variant="callout" color="text.secondary" hyphenate={false}>
            {t('maintenance.defaults.channels')}
          </Text>
          <Button
            label={t('maintenance.defaults.channelsLink')}
            variant="tertiary"
            size="s"
            role="link"
            onPress={() => router.push('/settings/notifications')}
            testID={`${ROUTE}.notifications`}
          />
        </View>
      </View>
    );
  }

  return (
    <SettingsPage routeId={ROUTE} title={t('maintenance.defaults.title')} fallback="/settings" section="reminders">
      {body}
    </SettingsPage>
  );
}
