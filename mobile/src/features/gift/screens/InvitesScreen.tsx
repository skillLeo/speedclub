import * as Clipboard from 'expo-clipboard';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import { inviteRedeemed, inviteUrl, useMyInvites, type Invite } from '@/api/queries/invites';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { shareLink } from '@/features/profile/share';
import { SettingsGuest } from '@/features/settings/components/SettingsGuest';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { siteUrl } from '@/features/settings/markdown/links';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { IconButton } from '@/ui/IconButton';
import { ListRow } from '@/ui/ListRow';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { RowGroup } from '@/ui/RowGroup';

import { qaGiftActive, qaInvites } from '../qaGift';

const ROUTE = 'INV-01';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  intro: { gap: t.space[8] },
  controls: { flexDirection: 'row', gap: t.space[4] },
  preview: { alignItems: 'flex-start', gap: t.space[12], width: '100%' },
  previewRows: { width: '100%' },
  skeleton: { gap: t.space[24] },
}));

/** "2 von 5 eingelöst". */
export function redeemedCount(invites: readonly Invite[]): number {
  return invites.filter(inviteRedeemed).length;
}

function InvitesSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`} style={styles.skeleton}>
      <SkeletonText variant="body" lines={2} />
      <SkeletonText variant="headline" width="40%" />
      <SkeletonBlock width="100%" height={size.row.withThumb * 5} corner="md" />
    </Skeleton>
  );
}

type RowsProps = {
  invites: readonly Invite[];
  site: string | null;
  disabled: boolean;
  /** The sample preview of the empty state: no actions. */
  preview?: boolean;
  testID: string;
};

/** The five codes, each open one with share and copy beside it, a redeemed one with who took it when the server names them. */
function InviteRows({ invites, site, disabled, preview = false, testID }: RowsProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const [busy, setBusy] = useState<string | null>(null);

  const share = async (invite: Invite) => {
    const url = inviteUrl(invite.code, site);
    if (!url) return;
    setBusy(invite.code);
    try {
      const outcome = await shareLink({ url, title: t('gift.invites.shareMessage') });
      if (outcome === 'copied') toast(t('gift.invites.copied'), { testID: `${ROUTE}.toast` });
      if (outcome === 'failed') toast(t('gift.invites.shareFailed', { url }), { testID: `${ROUTE}.toast` });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (invite: Invite) => {
    const url = inviteUrl(invite.code, site);
    try {
      await Clipboard.setStringAsync(url ?? invite.code);
      toast(t('gift.invites.copied'), { testID: `${ROUTE}.toast` });
    } catch {
      toast(t('gift.invites.copyFailed', { code: invite.code }), { testID: `${ROUTE}.toast` });
    }
  };

  return (
    <RowGroup testID={testID}>
      {invites.map((invite, index) => {
        const redeemed = inviteRedeemed(invite);
        const status = redeemed
          ? invite.accepted_by
            ? t('gift.invites.redeemedBy', { username: invite.accepted_by.username })
            : t('gift.invites.redeemed')
          : t('gift.invites.open');
        return (
          <ListRow
            key={invite.code}
            icon={redeemed ? 'check' : 'link'}
            title={invite.code}
            accessibilityTitle={t('gift.invites.codeLabel', { code: invite.code.split('').join(' '), status })}
            subtitle={status}
            hyphenate={false}
            divider={index < invites.length - 1}
            inset={space[16]}
            control={
              redeemed || preview ? undefined : (
                <View style={styles.controls}>
                  {site ? (
                    <IconButton
                      icon="share-network"
                      label={t('gift.invites.shareLabel', { code: invite.code })}
                      onPress={() => void share(invite)}
                      loading={busy === invite.code}
                      disabled={disabled}
                      testID={`${testID}.${invite.code}.share`}
                    />
                  ) : null}
                  <IconButton
                    icon="copy"
                    label={t('gift.invites.copyLabel', { code: invite.code })}
                    onPress={() => void copy(invite)}
                    disabled={disabled}
                    testID={`${testID}.${invite.code}.copy`}
                  />
                </View>
              )
            }
            testID={`${testID}.${invite.code}`}
          />
        );
      })}
    </RowGroup>
  );
}

/**
 * INV-01 Freunde einladen (contract §5, §8), from Einstellungen (SET-01 "Freunde einladen"): the five codes, open or redeemed, each
 * open one shared through the share sheet with its `https://<host>/join/{code}` link or copied. What it brings is said once and
 * nothing more: "Ihr bekommt beide das Abzeichen ‚Crew Starter‘."
 */
export function InvitesScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const sample = qaGiftActive();
  const query = useMyInvites();
  const site = siteUrl();
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const invites = live ? query.data?.invites : undefined;
  const restricted = qaState === 'restricted' || Boolean(me.data?.restrictions.suspended || me.data?.restrictions.publishing?.restricted);
  const error = query.error instanceof ApiError ? query.error : null;

  let body: ReactNode;
  if (status === 'guest') {
    body = <SettingsGuest routeId={ROUTE} returnTo="/settings/invites" />;
  } else if (qaState === 'loading' || status === 'loading' || (!invites && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) {
    body = <InvitesSkeleton />;
  } else if (qaState === 'error' || (!invites && qaState !== 'empty')) {
    const offline = qaState !== 'error' && (!online || query.fetchStatus === 'paused');
    body = (
      <ErrorState
        title={offline ? t('gift.invites.offlineTitle') : t('gift.invites.errorTitle')}
        message={offline ? t('gift.invites.offlineBody') : error?.message}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (qaState === 'empty' || !invites || invites.length === 0) {
    // 09 §5 "never empty": the five rows as they will look, badged; the codes come with the next read.
    body = (
      <EmptyState
        preview={
          <View style={styles.preview} aria-hidden testID={`${ROUTE}.empty.sample`}>
            <SampleBadge />
            <View style={styles.previewRows}>
              <InviteRows invites={qaInvites().invites.slice(0, 3)} site={site} disabled preview testID={`${ROUTE}.empty.sample.codes`} />
            </View>
          </View>
        }
        title={t('gift.invites.emptyTitle')}
        body={t('gift.invites.emptyBody')}
        action={{ label: t('gift.invites.retry'), onPress: () => void query.refetch(), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else {
    const used = redeemedCount(invites);
    body = (
      <View style={styles.body}>
        <View style={styles.intro}>
          {sample ? <SampleBadge testID={`${ROUTE}.sample`} /> : null}
          <Text variant="body" testID={`${ROUTE}.intro`}>
            {t('gift.invites.intro')}
          </Text>
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.reward`}>
            {t('gift.invites.reward')}
          </Text>
        </View>
        {restricted ? <FormNotice tone="info" message={t('gift.invites.restricted')} testID={`${ROUTE}.restricted`} /> : null}
        <Text variant="headline" numeric testID={`${ROUTE}.summary`}>
          {t('gift.invites.summary', { used: format.number(used), total: format.number(invites.length) })}
        </Text>
        <InviteRows invites={invites} site={site} disabled={restricted || !online} testID={`${ROUTE}.codes`} />
        {used === invites.length ? (
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.allUsed`}>
            {t('gift.invites.allUsed')}
          </Text>
        ) : null}
        {site ? null : (
          <Text variant="caption" color="text.tertiary" testID={`${ROUTE}.noSite`}>
            {t('gift.invites.noSite', { code: invites.find((invite) => !inviteRedeemed(invite))?.code ?? '' })}
          </Text>
        )}
      </View>
    );
  }

  return (
    <SettingsPage routeId={ROUTE} title={t('gift.invites.title')} fallback="/settings" offlineLabel={t('gift.invites.offline')} section="invites">
      {body}
    </SettingsPage>
  );
}
