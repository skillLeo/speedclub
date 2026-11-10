import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { photoFields, variantUrl } from '@/features/profile/media';
import { BlockDialog } from '@/features/safety/BlockDialog';
import { conversationTarget } from '@/features/safety/targets';
import { useReport } from '@/features/safety/useReport';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { RowGroup } from '@/ui/RowGroup';
import { createStyles, layout, size, space, useBreakpoint } from '@/theme';
import { Dialog, EmptyState, ErrorState, Header, ListRow, MemberRow, OfflineBanner, Screen, Skeleton, SkeletonBlock, SkeletonText, Switch, toast } from '@/ui';
import { RowDivider } from '@/ui/rowParts';

import { MuteSheet, muteChange } from '../components/Sheets';
import { isConversationGone, useMessaging, type MuteChange } from '../data';
import { MESSAGE_GLYPHS } from '../glyphs';
import { isMuted, type ConversationDetail } from '../model';
import { otherHandle, otherName } from '../text';

import { MESSAGING_FLAGS } from './ThreadPane';

const ROUTE = 'MSG-05';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  section: { marginTop: t.space[24] },
  state: { paddingTop: t.space[32] },
  // DQ-419: the rows sit in FS-12 inset groups (bg.surface, radius 12), as on the settings pages, never on the canvas.
  firstGroup: { marginTop: t.space[16] },
  skeletonCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  skeletonText: { flex: 1 },
}));

export type ConversationInfoScreenProps = {
  /** M2.6's report flow for the conversation; the row is offered once the flow exists. */
  onReport?: (conversation: ConversationDetail) => void;
};

/**
 * MSG-05 `/messages/[conversationId]/info` (contract §7): the member (→ PROF-02), the conversation's vehicle, Stummschalten
 * [SIG organise], Blockieren, Melden (M2.6) and Unterhaltung löschen behind a dialog.
 */
export function ConversationInfoScreen({ onReport }: ConversationInfoScreenProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const padding = useTabBarPadding();
  const { gutter, kind } = useBreakpoint();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const id = paramOf(params.conversationId);
  const back = useBack(id ? `/messages/${id}` : '/messages');
  const adapter = useMessaging();
  const actions = adapter.useActions();
  const organiseFlag = useFlag(MESSAGING_FLAGS.organise);
  const query = adapter.useConversation(adapter.available ? id : undefined);
  const [muting, setMuting] = useState(false);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const leaveToInbox = () => router.dismissTo('/messages');
  const data = qaState === 'default' || qaState === 'offline' ? query.data : undefined;
  // M2.6 "Melden": the conversation goes in as its newest message from the other member, with the messages around it.
  const report = useReport(null, { routeId: ROUTE, onBlocked: leaveToInbox });
  // Read for "Melden" and for the vehicle the conversation shares when it was not started from one (DQ-419). Only its newest page
  // is read here: a vehicle shared further back than that page shows no row (known limit, code review nit 7).
  const thread = adapter.useThread(adapter.available ? id : undefined);
  const reportConversation =
    onReport ??
    (report.available && data && !data.otherDeleted
      ? (conversation: ConversationDetail) => {
          const target = conversationTarget(thread.data ?? [], conversation.other?.username ?? null);
          if (target) report.openFor(target);
        }
      : undefined);

  const mute = (change: MuteChange, done: string) => {
    if (!data) return;
    actions
      .organise(data.id, { mute: change })
      .then(() => toast(t(done), { testID: `${ROUTE}.toast` }))
      .catch(() => toast(t('organise.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }));
  };
  const remove = () => {
    setDeleting(false);
    if (!data) return;
    setBusy(true);
    const request = data.folder === 'requests';
    actions
      .deleteConversation(data.id)
      .then(() => {
        toast(t(request ? 'request.declined' : 'organise.deleted'), { testID: `${ROUTE}.toast` });
        leaveToInbox();
      })
      .catch(() => toast(t('organise.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }))
      .finally(() => setBusy(false));
  };

  let body: ReactNode;
  if (qaState === 'loading' || (!data && query.isPending && qaState !== 'error' && qaState !== 'empty')) {
    // DQ-422: the loaded page's geometry: the member's group, then the group of mute, block and report, then delete.
    const actionRow = (index: number, last: boolean) => (
      <View key={index}>
        <View style={styles.skeletonRow}>
          <SkeletonBlock width={space[20]} height={space[20]} corner="sm" />
          <SkeletonText variant="body" width="45%" style={styles.skeletonText} />
        </View>
        {last ? null : <RowDivider inset={space[16]} />}
      </View>
    );
    body = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={[styles.skeletonCard, styles.firstGroup]}>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
            <View style={styles.skeletonText}>
              <SkeletonText variant="bodyStrong" width="50%" />
              <SkeletonText variant="supporting" width="30%" />
            </View>
          </View>
        </View>
        <View style={[styles.skeletonCard, styles.section]}>{[0, 1, 2].map((index) => actionRow(index, index === 2))}</View>
        <View style={[styles.skeletonCard, styles.section]}>{actionRow(3, true)}</View>
      </Skeleton>
    );
  } else if (qaState === 'restricted' || qaState === 'empty' || (!data && isConversationGone(query.error))) {
    body = (
      <View style={styles.state}>
        <EmptyState
          icon="chat-circle"
          title={t('thread.goneTitle')}
          body={t('thread.goneBody')}
          action={{ label: t('thread.goneAction'), onPress: leaveToInbox, variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.gone`}
        />
      </View>
    );
  } else if (!data) {
    const offline = !online || query.isPaused;
    body = (
      <View style={styles.state}>
        <ErrorState
          title={offline ? t('thread.offlineTitle') : t('thread.errorTitle')}
          message={offline ? t('thread.offlineBody') : undefined}
          onRetry={query.refetch}
          retrying={query.isFetching}
          testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
        />
      </View>
    );
  } else {
    const name = otherName(data, t);
    const handle = otherHandle(data);
    const muted = isMuted(data, now());
    const shared = (thread.data ?? []).find((message) => message.kind === 'vehicle' && message.vehicle)?.vehicle ?? null;
    const vehicle = data.contextVehicle ?? data.vehicle ?? shared;
    body = (
      <>
        <RowGroup style={styles.firstGroup} testID={`${ROUTE}.memberGroup`}>
          <MemberRow
            name={name}
            meta={handle ?? undefined}
            avatarUri={variantUrl(data.other?.avatar, size.avatar.md)}
            avatarBlurhash={data.other?.avatar?.blurhash}
            onPress={data.other && !data.otherDeleted ? () => router.push({ pathname: '/u/[username]', params: { username: data.other?.username ?? '' } }) : undefined}
            inset={space[16]}
            testID={`${ROUTE}.member`}
          />
        </RowGroup>
        {vehicle ? (
          <RowGroup title={t('info.sharedVehicle')} style={styles.section} testID={`${ROUTE}.vehicleGroup`}>
            <ListRow
              title={keepNameTogether(vehicle.title)}
              subtitle={vehicle.ownerUsername ? t('thread.contextOwner', { username: vehicle.ownerUsername }) : undefined}
              thumb={photoFields(vehicle.cover, size.thumb.row)}
              hyphenate={false}
              onPress={() => router.push({ pathname: '/v/[slug]', params: { slug: vehicle.slug } })}
              inset={space[16]}
              testID={`${ROUTE}.vehicle`}
            />
          </RowGroup>
        ) : null}
        {/* Only with a row in it: no empty card when mute is off by flag and the other member is gone (code review nit 6). */}
        {organiseFlag || (data.other && !data.otherDeleted) || reportConversation ? (
          <RowGroup style={styles.section} testID={`${ROUTE}.actions`}>
            {organiseFlag ? (
              <ListRow
                title={t('info.mute')}
                subtitle={t('info.muteHelper')}
                icon={MESSAGE_GLYPHS.muted}
                control={
                  <Switch
                    value={muted}
                    label={t('info.mute')}
                    onValueChange={(next) => (next ? setMuting(true) : mute('off', 'organise.unmuted'))}
                    testID={`${ROUTE}.mute`}
                  />
                }
                inset={space[16]}
                divider={Boolean((data.other && !data.otherDeleted) || reportConversation)}
                testID={`${ROUTE}.muteRow`}
              />
            ) : null}
            {data.other && !data.otherDeleted ? (
              <ListRow
                title={t('info.block', { name: handle ?? name })}
                icon={MESSAGE_GLYPHS.block}
                destructive
                role="button"
                chevron={false}
                onPress={() => setBlocking(data.other?.username ?? null)}
                inset={space[16]}
                divider={Boolean(reportConversation)}
                testID={`${ROUTE}.block`}
              />
            ) : null}
            {reportConversation ? (
              // DQ-419: reporting is not destructive: text.primary, its icon text.secondary. Block and delete stay accent.fg.
              <ListRow title={t('info.report')} icon={MESSAGE_GLYPHS.report} role="button" chevron={false} onPress={() => reportConversation(data)} inset={space[16]} testID={`${ROUTE}.report`} />
            ) : null}
          </RowGroup>
        ) : null}
        <RowGroup style={styles.section} testID={`${ROUTE}.deleteGroup`}>
          <ListRow
            title={data.folder === 'requests' ? t('info.deleteRequest') : t('info.delete')}
            icon={MESSAGE_GLYPHS.delete}
            destructive
            role="button"
            chevron={false}
            disabled={busy}
            onPress={() => setDeleting(true)}
            inset={space[16]}
            testID={`${ROUTE}.delete`}
          />
        </RowGroup>
      </>
    );
  }

  const name = data ? otherName(data, t) : '';
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={t('info.title')} onBack={back} contentMaxWidth={kind === 'phone' ? undefined : layout.feedColumn} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner label={t('offlineBanner')} testID={`${ROUTE}.offline`} />}
      <ScrollView style={styles.scroll} contentContainerStyle={padding}>
        <View style={[styles.column, { paddingHorizontal: gutter }]}>{body}</View>
      </ScrollView>
      <MuteSheet
        visible={muting}
        onClose={() => setMuting(false)}
        onChoose={(choice) => mute(muteChange(choice, now()), 'organise.muted')}
        testID={`${ROUTE}.muteSheet`}
      />
      <BlockDialog username={blocking} onClose={() => setBlocking(null)} onBlocked={leaveToInbox} testID={`${ROUTE}.blockDialog`} />
      {report.element}
      <Dialog
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={data?.folder === 'requests' ? t('request.declineTitle') : t('organise.deleteTitle')}
        body={t(data?.folder === 'requests' ? 'request.declineBody' : 'organise.deleteBody', { name })}
        testID={`${ROUTE}.deleteDialog`}
        actions={[
          { label: t('organise.cancel'), variant: 'secondary', onPress: () => setDeleting(false), testID: `${ROUTE}.deleteDialog.cancel` },
          { label: t('organise.delete'), destructive: true, onPress: remove, testID: `${ROUTE}.deleteDialog.confirm` },
        ]}
      />
    </Screen>
  );
}
