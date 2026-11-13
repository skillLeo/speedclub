import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMemberSettings, useSetShowOwnerOnQr } from '@/api/queries/settings';
import { useFlag } from '@/api/queries/appConfig';
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
import { privacyOf, useUpdatePrivacy, type MentionPrivacy, type PrivacyPatch, type PrivacyValues, type WhoCanMessage } from '@/api/queries/settings';
import { useAnySuggestionFlag } from '@/features/ai/availability';
import { SettingsGuest } from '../components/SettingsGuest';

const ROUTE = 'SET-07';
export const READ_RECEIPTS_FLAG = 'sig.msg_read_receipts';
/** M4.11 (09 §8.5): mentions and their privacy choice. */
export const MENTIONS_FLAG = 'mentions';
const MENTION_OPTIONS: readonly MentionPrivacy[] = ['everyone', 'followers', 'nobody'];

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
            <SkeletonText variant="callout" width="30%" style={styles.skeletonLabel} />
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
  const mentions = useFlag(MENTIONS_FLAG);
  const aiFlags = useAnySuggestionFlag();
  // Optimistic in the settings cache: a value moves at once and goes back when the server refuses it.
  const values: PrivacyValues = privacyOf(settings.data);
  const disabled = !online;

  const saved = () => toast(t('privacy.saved'), { testID: `${ROUTE}.saved` });
  const refused = (error: unknown) => toast(failure(error), { haptic: 'warning', testID: `${ROUTE}.failed` });

  const change = (patch: PrivacyPatch) => updatePrivacy.mutate(patch, { onSuccess: saved, onError: refused });

  let body: ReactNode;
  if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/privacy" />;
  } else if (qaState === 'loading' || status === 'loading' || (settings.isPending && settings.fetchStatus !== 'paused' && qaState !== 'error')) {
    body = <PrivacySkeleton groups={[3, ...(mentions ? [3] : []), readReceipts ? 4 : 3, ...(aiFlags ? [1] : []), 1]} />;
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
        {mentions ? (
          // ADR-436 b: a mention that is not allowed stays plain text, with no notification and no explanation.
          <RowGroup title={t('privacy.mentionsGroup')} testID={`${ROUTE}.mentions`}>
            <RadioRows<MentionPrivacy>
              label={t('privacy.mentionPrivacy')}
              value={data.mention_privacy}
              onChange={(next) => change({ mention_privacy: next })}
              disabled={disabled}
              options={MENTION_OPTIONS.map((option) => ({
                value: option,
                label: t(`privacy.mention.${option}`),
                helper: t(`privacy.mention.${option}Helper`),
              }))}
              testID={`${ROUTE}.mentionPrivacy`}
            />
          </RowGroup>
        ) : null}
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
          <Text variant="callout" color="text.secondary" style={styles.note} testID={`${ROUTE}.offlineNote`}>
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
