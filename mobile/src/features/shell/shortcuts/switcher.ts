/**
 * The quick switcher's list (⌘K / Ctrl K): the member's vehicles, recent conversations, the settings pages and the tabs.
 * Typing filters by word start first, then anywhere; Enter opens the active entry.
 */
export type SwitcherGroup = 'vehicles' | 'conversations' | 'settings' | 'tabs';

export const SWITCHER_GROUPS: readonly SwitcherGroup[] = ['vehicles', 'conversations', 'settings', 'tabs'];

export type SwitcherItem = {
  id: string;
  group: SwitcherGroup;
  label: string;
  detail?: string;
  href: string;
};

/** Per group without a query, so the list stays short; a query searches everything. */
export const SWITCHER_GROUP_LIMIT = 5;
export const SWITCHER_MAX_RESULTS = 20;

/** Lowercase without accents: "skoda" finds "Škoda", "uber" finds "Über". */
export function switcherKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function matchRank(item: SwitcherItem, needle: string): number | null {
  const haystack = switcherKey([item.label, item.detail ?? ''].join(' '));
  const words = haystack.split(/[\s\-·@/.]+/).filter(Boolean);
  if (haystack.startsWith(needle)) return 0;
  if (words.some((word) => word.startsWith(needle))) return 1;
  if (haystack.includes(needle)) return 2;
  return null;
}

/** The entries in group order. A query keeps those that match, best first, the group order breaking ties. */
export function filterSwitcher(items: readonly SwitcherItem[], query: string): SwitcherItem[] {
  const needle = switcherKey(query);
  const order = (item: SwitcherItem) => SWITCHER_GROUPS.indexOf(item.group);
  if (!needle) {
    return SWITCHER_GROUPS.flatMap((group) => items.filter((item) => item.group === group).slice(0, SWITCHER_GROUP_LIMIT));
  }
  return items
    .map((item, index) => ({ item, index, rank: matchRank(item, needle) }))
    .filter((entry): entry is { item: SwitcherItem; index: number; rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || order(left.item) - order(right.item) || left.index - right.index)
    .slice(0, SWITCHER_MAX_RESULTS)
    .map((entry) => entry.item);
}

/** Arrow keys move through the results and wrap around; an empty list has no active entry. */
export function moveActive(index: number, count: number, step: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return step === 1 ? 0 : count - 1;
  return (index + step + count) % count;
}

/** What the switcher needs of a conversation (features/messages `ConversationSummary`). */
export type SwitcherConversation = {
  id: string;
  other: { username: string; displayName: string | null } | null;
  vehicle: { title: string } | null;
};

/**
 * Recent conversations as entries: the member's name (their handle when they set none), the handle and the car the chat is about as
 * the detail, so typing "skyline" finds the chat about the R34. Opens MSG-02.
 */
export function conversationItems(conversations: readonly SwitcherConversation[], fallbackName: string): SwitcherItem[] {
  return conversations.map((conversation) => {
    const handle = conversation.other ? `@${conversation.other.username}` : null;
    const name = conversation.other?.displayName?.trim() || handle || fallbackName;
    const detail = [name === handle ? null : handle, conversation.vehicle?.title].filter(Boolean).join(' · ');
    return {
      id: `conversation.${conversation.id}`,
      group: 'conversations',
      label: name,
      ...(detail ? { detail } : {}),
      href: `/messages/${conversation.id}`,
    };
  });
}
