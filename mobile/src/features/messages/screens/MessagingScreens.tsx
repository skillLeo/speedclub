import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useHideTabBar } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { EmptyState, Screen } from '@/ui';

import { useMessaging } from '../data';
import type { ConversationSummary, Folder } from '../model';

import { InboxPane } from './InboxPane';
import { ThreadPane } from './ThreadPane';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  split: { flex: 1, flexDirection: 'row' },
  // §5 "Inbox split 360 + thread".
  listPane: { borderRightColor: t.color.border.subtle, borderRightWidth: t.size.border.control, width: layout.inboxPane },
  threadPane: { flex: 1, minWidth: 0 },
  select: { flex: 1, justifyContent: 'center', paddingBottom: t.space[48] },
}));

/** The web from 1280 (and any window that wide): list and thread side by side. */
export function useSplitView(): boolean {
  return useBreakpoint().kind === 'desktop';
}

/** Where a conversation opens: requests in MSG-04, the rest in MSG-02. */
export function conversationHref(conversation: Pick<ConversationSummary, 'id' | 'folder'>) {
  return conversation.folder === 'requests'
    ? ({ pathname: '/messages/requests/[conversationId]', params: { conversationId: conversation.id } } as const)
    : ({ pathname: '/messages/[conversationId]', params: { conversationId: conversation.id } } as const);
}

function folderOf(value: string | undefined): Folder {
  return value === 'requests' || value === 'archived' ? value : 'chats';
}

type SplitProps = { selectedId?: string; folder: Folder; thread: ReactNode };

/** §5 inbox split: the 360 list on the left, the thread or "Wähle eine Unterhaltung" on the right. */
function Split({ selectedId, folder, thread }: SplitProps) {
  const styles = useStyles();
  const router = useRouter();
  const open = useCallback(
    (conversation: ConversationSummary) => {
      // Beside an open thread the next one replaces it, so back leaves the inbox instead of walking through every thread opened.
      if (selectedId) router.replace(conversationHref(conversation));
      else router.push(conversationHref(conversation));
    },
    [router, selectedId],
  );
  return (
    <View style={styles.split}>
      <View style={styles.listPane}>
        <InboxPane
          folder={folder}
          selectedId={selectedId}
          onFolder={(next) => router.setParams({ folder: next })}
          onOpen={open}
          onBack={folder === 'archived' ? () => router.back() : undefined}
        />
      </View>
      <View style={styles.threadPane}>{thread}</View>
    </View>
  );
}

function SelectConversation() {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  return (
    <View style={styles.select}>
      <EmptyState icon="chats" title={t('inbox.selectTitle')} body={t('inbox.selectBody')} testID="MSG-01.select" />
    </View>
  );
}

/** MSG-01 `/messages` (`?folder=requests|archived`). */
export function InboxScreen() {
  const router = useRouter();
  const split = useSplitView();
  const params = useLocalSearchParams<{ folder?: string }>();
  const folder = folderOf(paramOf(params.folder));
  const open = useCallback((conversation: ConversationSummary) => router.push(conversationHref(conversation)), [router]);
  return (
    <Screen edges={EDGES} testID="MSG-01.root">
      {split ? (
        <Split folder={folder} thread={<SelectConversation />} />
      ) : (
        <InboxPane
          folder={folder}
          onFolder={(next) => router.setParams({ folder: next })}
          onOpen={open}
          onBack={folder === 'archived' ? () => router.back() : undefined}
        />
      )}
    </Screen>
  );
}

type ThreadRouteProps = { request: boolean };

function ThreadRoute({ request }: ThreadRouteProps) {
  const router = useRouter();
  const split = useSplitView();
  const adapter = useMessaging();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const id = paramOf(params.conversationId);
  const routeId = request ? 'MSG-04' : 'MSG-02';
  const back = useBack('/messages');
  // §9: the composer takes the place of the tab bar, as an editor does.
  useHideTabBar();
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/messages');
  }, [router]);
  const info = useCallback((conversationId: string) => router.push({ pathname: '/messages/[conversationId]/info', params: { conversationId } }), [router]);
  const thread = (
    <ThreadPane conversationId={adapter.available ? id : undefined} routeId={routeId} onBack={split ? undefined : back} onInfo={request ? undefined : info} onLeave={leave} />
  );
  return (
    <Screen edges={EDGES} testID={`${routeId}.screen`}>
      {split ? <Split folder={request ? 'requests' : 'chats'} selectedId={id} thread={thread} /> : thread}
    </Screen>
  );
}

/** MSG-02 `/messages/[conversationId]` (FS-7). */
export function ConversationScreen() {
  return <ThreadRoute request={false} />;
}

/** MSG-04 `/messages/requests/[conversationId]`: FS-7 request mode, never marked read. */
export function RequestScreen() {
  return <ThreadRoute request />;
}
