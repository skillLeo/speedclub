import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMemberSettings, useSetShowOwnerOnQr } from '@/api/queries/settings';
import { useFlag } from '@/api/queries/appConfig';
import { GuestInvitation } from '@/features/profile/components/GuestInvitation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { ErrorState, ListRow, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';

import { RestrictionNotice } from '../components/RestrictionNotice';
import { RowGroup } from '@/ui/RowGroup';
import { RadioRows, SwitchRow } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { ROW_INSET } from '../components/ValueRow';
import { useFailureMessage } from '../forms';
import { SETTINGS_PATHS } from '../navigation';
import { privacyOf, useUpdatePrivacy, type PrivacyPatch, type PrivacyValues, type WhoCanMessage } from '@/api/queries/settings';
import { useAnySuggestionFlag } from '@/features/ai/availability';

const ROUTE = 'SET-07';
export const READ_RECEIPTS_FLAG = 'sig.msg_read_receipts';

const useStyles = createStyles((t) => ({
  groups: { gap: t.space[32] },
  skeletonGroup: { gap: t.space[8] },
  skeletonLabel: { paddingHorizontal: t.space[16] },
  note: { paddingHorizontal: t.space[16] },
}));

function PrivacySkeleton({ groups }: { groups: readonly number[] }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.groups}>
        {groups.map((rows, index) => (
          <View key={index} style={styles.skeletonGroup}>
            <SkeletonText variant="labelS" width="30%" style={styles.skeletonLabel} />
            <SkeletonBlock height={size.row.withThumb * rows} corner="md" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/**
 * SET-07 /settings/privacy: who may write, as a radio list; then switches, each with what it changes in plain words. A change
 * applies at once and goes back with a message when the server refuses it. Offline the controls rest: nothing is queued.
 */
export function PrivacyScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const failure = useFailureMessage();
  const settings = useMemberSettings();
  const ownerOnQr = useSetShowOwnerOnQr();
  const updatePrivacy = useUpdatePrivacy();
  const readReceipts = useFlag(READ_RECEIPTS_FLAG);
  const aiFlags = useAnySuggestionFlag();
  // Optimistic in the settings cache: a value moves at once and goes back when the server refuses it.
  const values: PrivacyValues = privacyOf(settings.data);
  const disabled = !online;

  const saved = () => toast(t('privacy.saved'), { testID: `${ROUTE}.saved` });
  const refused = (error: unknown) => toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });

  const change = (patch: PrivacyPatch) => updatePrivacy.mutate(patch, { onSuccess: saved, onError: refused });

  let body: ReactNode;
  if (status === 'guest') {
    body = <GuestInvitation routeId={ROUTE} returnTo="/settings/privacy" />;
  } else if (qaState === 'loading' || status === 'loading' || (settings.isPending && settings.fetchStatus !== 'paused' && qaState !== 'error')) {
    body = <PrivacySkeleton groups={aiFlags ? [3, readReceipts ? 4 : 3, 1, 1] : [3, readReceipts ? 4 : 3, 1]} />;
  } else if (qaState === 'error' || !settings.data) {
    const offline = !online || settings.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('common.loadErrorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    const data = settings.data;
    body = (
      <View style={styles.groups}>
        <RestrictionNotice routeId={ROUTE} />
        <RowGroup title={t('privacy.messagesGroup')} testID={`${ROUTE}.messages`}>
          <RadioRows<WhoCanMessage>
            label={t('privacy.whoCanMessage')}
            value={values.who_can_message}
            onChange={(next) => change({ who_can_message: next })}
            disabled={disabled}
            options={(['everyone', 'following', 'nobody'] as const).map((option) => ({
              value: option,
              label: t(`privacy.who.${option}`),
              helper: t(`privacy.who.${option}Helper`),
            }))}
            testID={`${ROUTE}.whoCanMessage`}
          />
        </RowGroup>
        <RowGroup title={t('privacy.visibilityGroup')} testID={`${ROUTE}.visibility`}>
          <SwitchRow
            title={t('privacy.discoverable')}
            helper={t('privacy.discoverableHelper')}
            value={values.discoverable}
            onValueChange={(next) => change({ discoverable: next })}
            disabled={disabled}
            divider
            testID={`${ROUTE}.discoverable`}
          />
          <SwitchRow
            title={t('privacy.indexable')}
            helper={t('privacy.indexableHelper')}
            value={values.indexable}
            onValueChange={(next) => change({ indexable: next })}
            disabled={disabled}
            divider
            testID={`${ROUTE}.indexable`}
          />
          <SwitchRow
            title={t('privacy.ownerOnQr')}
            helper={t('privacy.ownerOnQrHelper')}
            value={data.show_owner_on_qr}
            onValueChange={(next) => ownerOnQr.mutate(next, { onSuccess: saved, onError: refused })}
            disabled={disabled}
            divider={readReceipts}
            testID={`${ROUTE}.ownerOnQr`}
          />
          {readReceipts ? (
            <SwitchRow
              title={t('privacy.readReceipts')}
              helper={t('privacy.readReceiptsHelper')}
              value={values.read_receipts}
              onValueChange={(next) => change({ read_receipts: next })}
              disabled={disabled}
              testID={`${ROUTE}.readReceipts`}
            />
          ) : null}
        </RowGroup>
        {aiFlags ? (
          // M3.7 (02 §6): the opt-in of the [AI] suggestions, off by default; the helper names the provider as processor.
          <RowGroup title={t('privacy.aiGroup')} testID={`${ROUTE}.aiGroup`}>
            <SwitchRow
              title={t('privacy.aiSuggestions')}
              helper={t('privacy.aiSuggestionsHelper')}
              value={data.ai_suggestions}
              onValueChange={(next) => change({ ai_suggestions: next })}
              disabled={disabled}
              testID={`${ROUTE}.aiSuggestions`}
            />
          </RowGroup>
        ) : null}
        <RowGroup title={t('privacy.blockGroup')} testID={`${ROUTE}.blockGroup`}>
          <ListRow
            icon="prohibit"
            title={t('rows.blocked')}
            onPress={() => router.push(SETTINGS_PATHS.blocked)}
            inset={ROW_INSET}
            testID={`${ROUTE}.blocked`}
          />
        </RowGroup>
        {disabled ? (
          <Text variant="supporting" color="text.secondary" style={styles.note} testID={`${ROUTE}.offlineNote`}>
            {t('privacy.offlineNote')}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <SettingsPage routeId={ROUTE} title={t('privacy.title')} fallback="/settings" offlineLabel={t('privacy.offlineBanner')} section="privacy">
      {body}
    </SettingsPage>
  );
}
