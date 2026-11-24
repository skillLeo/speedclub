/**
 * M5.8 Forum, the pure rules: the filters in the address, the list's empty states, the composer's validation and "Ähnliche Themen",
 * the content tree's safety, the vote answer, pre-moderation, the reply cache edits, the notification rows and SET-09's forum rows.
 */
import { QueryClient, type InfiniteData } from '@tanstack/react-query';

import {
  forumKeys,
  forumQueryOf,
  insertPost,
  patchPost,
  replacePost,
  type ForumPost,
} from '@/api/queries/forum';
import type { AppNotification } from '@/api/queries/notifications';
import { isPremoderated } from '@/features/forum/access';
import { blocksOf, excerptOf, isBlock, plainTextOf, safeHref, type ForumBlock } from '@/features/forum/content';
import {
  canVote,
  categoryChips,
  isLocalPost,
  reasonText,
  SEEK_PAGE_CAP,
  seekStep,
  composerCategories,
  composerIssues,
  filtersFromParams,
  listEmptyKind,
  parseTags,
  replyParentOf,
  similarQueryOf,
  topCategoryOf,
  topIndexOf,
} from '@/features/forum/model';
import { matchesFilter, notificationCategory, notificationIcon, notificationTarget, notificationText } from '@/features/home/notifications';
import { forumRows, forumSwitchPatch } from '@/features/settings/screens/NotificationSettingsScreen';
import i18n from '@/i18n';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const THREAD = '01JTHREAD00000000000000001';
const POST = '01JPST00000000000000000001';

function post(id: string, extra: Partial<ForumPost> = {}): ForumPost {
  return {
    id,
    thread_id: THREAD,
    parent_id: null,
    status: 'published',
    author: { username: 'lukas.sc', display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false },
    body: null,
    content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Nimm die H&R mit 30 mm.', bold: false, italic: false }] }],
    helpful_count: 2,
    viewer_voted: false,
    is_solution: false,
    deleted: false,
    mentions: [],
    edited_at: null,
    created_at: '2026-11-15T10:00:00Z',
    replies: [],
    review_reason: null,
    viewer: { is_author: false, can_edit: false, can_delete: false, can_vote: true, can_report: true },
    ...extra,
  };
}

describe('FOR-01/02 filters and empty states', () => {
  it('reads category, sort and words from the address, ignoring what the server would refuse', () => {
    expect(filtersFromParams({ category: 'fahrwerk', sort: 'solved', q: 'E46 Federn' })).toEqual({ category: 'fahrwerk', sort: 'solved', q: null, text: 'E46 Federn' });
    expect(filtersFromParams({ category: '../admin', sort: 'hot' })).toEqual({ category: null, sort: 'active', q: null, text: '' });
  });

  it('searches only from two characters, words trimmed and joined', () => {
    expect(forumQueryOf(' a ')).toBeNull();
    expect(forumQueryOf('  Bremsen   E46 ')).toBe('Bremsen E46');
  });

  it('picks the empty state the reader caused', () => {
    expect(listEmptyKind(3, { category: null, sort: 'active', q: null })).toBe('none');
    expect(listEmptyKind(0, { category: null, sort: 'active', q: null })).toBe('empty');
    expect(listEmptyKind(0, { category: null, sort: 'unanswered', q: null })).toBe('unanswered');
    expect(listEmptyKind(0, { category: null, sort: 'active', q: 'turbo' })).toBe('filtered');
    expect(listEmptyKind(0, { category: 'motor', sort: 'active', q: null })).toBe('filtered');
    // FOR-02: its own category is the base, not a filter.
    expect(listEmptyKind(0, { category: 'motor', sort: 'active', q: null }, 'motor')).toBe('empty');
    expect(listEmptyKind(0, { category: null, sort: 'new', q: null })).toBe('filtered');
  });

  const tree = [
    { id: 1, slug: 'technik-tuning', kind: 'standard' as const, name: 'Technik & Tuning', description: null, icon: null, parent_id: null, children: [
      { id: 2, slug: 'fahrwerk', kind: 'standard' as const, name: 'Fahrwerk', description: null, icon: null, parent_id: 1, children: [] },
    ] },
    { id: 3, slug: 'off-topic', kind: 'standard' as const, name: 'Off-Topic', description: null, icon: null, parent_id: null, children: [] },
  ];

  it('builds the chips with "Alle" first and the composer list with sub-forums under their parent', () => {
    expect(categoryChips(tree, 'Alle').map((chip) => chip.slug)).toEqual([null, 'technik-tuning', 'off-topic']);
    expect(composerCategories(tree)).toEqual([
      { slug: 'fahrwerk', label: 'Fahrwerk', group: 'Technik & Tuning' },
      { slug: 'off-topic', label: 'Off-Topic', group: null },
    ]);
    expect(topCategoryOf(tree, 'fahrwerk')?.slug).toBe('technik-tuning');
    expect(topCategoryOf(tree, 'nope')).toBeNull();
  });
});

describe('FOR-04 validation and "Ähnliche Themen"', () => {
  const valid = { title: 'Welche Federn für den E46 Touring?', category: 'fahrwerk', body: 'Ich suche Federn mit Gutachten.', tags: 'fahrwerk, e46' };

  it('accepts a complete thread', () => {
    expect(composerIssues(valid)).toEqual({});
  });

  it('names every problem the server would answer with a 422', () => {
    expect(composerIssues({ title: 'Hi', category: '', body: 'kurz', tags: 'a, b c' })).toEqual({
      title: 'titleShort',
      category: 'categoryMissing',
      body: 'bodyShort',
      tags: 'tagsInvalid',
    });
    expect(composerIssues({ ...valid, title: 'x'.repeat(121) }).title).toBe('titleLong');
    expect(composerIssues({ ...valid, body: 'x'.repeat(10001) }).body).toBe('bodyLong');
    expect(composerIssues({ ...valid, tags: 'a1, b2, c3, d4, e5, f6' }).tags).toBe('tagsTooMany');
  });

  it('lower-cases tags, drops a leading hash and duplicates', () => {
    expect(parseTags(' Fahrwerk, #E46 , fahrwerk,, Bremsen ')).toEqual(['fahrwerk', 'e46', 'bremsen']);
  });

  it('asks for similar threads from three characters of title', () => {
    expect(similarQueryOf('E4')).toBeNull();
    expect(similarQueryOf('  E46   Federn ')).toBe('E46 Federn');
  });
});

describe('content tree (m5.8-contract D5)', () => {
  it('reads list items at any depth and drops what is not a block', () => {
    const nested: unknown[] = [{ type: 'paragraph', children: [{ type: 'text', text: 'Drei', bold: false, italic: false }] }, { type: 'html', html: '<script>' }, 'x'];
    expect(blocksOf(nested)).toEqual([nested[0]]);
    expect(isBlock({ type: 'list', items: [] })).toBe(true);
    expect(isBlock(null)).toBe(false);
    const list: ForumBlock = {
      type: 'list',
      ordered: true,
      start: 3,
      items: [[{ type: 'paragraph', children: [{ type: 'text', text: 'Eins', bold: false, italic: false }] }], [{ type: 'paragraph', children: [{ type: 'link', href: 'https://example.org/teile', children: [] }] }]],
    };
    expect(plainTextOf([list])).toBe('Eins https://example.org/teile');
  });

  it('opens only absolute http(s) addresses', () => {
    expect(safeHref('https://speedclub.test/v/e46')).toBe('https://speedclub.test/v/e46');
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('//evil.test')).toBeNull();
    expect(safeHref('https://exa mple.org')).toBeNull();
  });

  it('turns a post into a line for the quote bar', () => {
    const blocks: ForumBlock[] = [{ type: 'paragraph', children: [{ type: 'text', text: 'Die Bilstein B12 passen beim Touring problemlos, nur die Domlager prüfen.', bold: false, italic: false }] }];
    expect(plainTextOf(blocks)).toContain('Bilstein B12');
    expect(excerptOf(blocks, 30)).toBe('Die Bilstein B12 passen beim…');
  });
});

describe('FOR-03 rules', () => {
  it('lets members vote on others’ published replies only', () => {
    expect(canVote(post('a'))).toBe(true);
    expect(canVote(post('a', { viewer: { ...post('a').viewer, is_author: true } }))).toBe(false);
    expect(canVote(post('a', { status: 'pending' }))).toBe(false);
    expect(canVote(post('a', { deleted: true }))).toBe(false);
    expect(canVote(post('local-1'))).toBe(false);
  });

  it('answers to an answer join its top-level reply (one level of nesting)', () => {
    expect(replyParentOf(post('a'))).toBe('a');
    expect(replyParentOf(post('b', { parent_id: 'a' }))).toBe('a');
    const list = [post('a', { replies: [post('b', { parent_id: 'a' })] }), post('c')];
    expect(topIndexOf(list, 'b')).toBe(0);
    expect(topIndexOf(list, 'c')).toBe(1);
    expect(topIndexOf(list, 'x')).toBe(-1);
  });

  it('pre-moderates accounts younger than three days or without a verified e-mail', () => {
    const at = new Date('2026-11-16T12:00:00Z');
    expect(isPremoderated({ email_verified: false, member_since: '2025-01-01T00:00:00Z' }, at)).toBe(true);
    expect(isPremoderated({ email_verified: true, member_since: '2026-11-15T00:00:00Z' }, at)).toBe(true);
    expect(isPremoderated({ email_verified: true, member_since: '2026-11-01T00:00:00Z' }, at)).toBe(false);
    expect(isPremoderated(undefined, at)).toBe(false);
  });
});

describe('review m5.8 (SF-6 and nits)', () => {
  it('SF-6: reads the next page until the reply turns up, within the cap', () => {
    const base = { found: false, hasNext: true, fetching: false, failed: false, pages: 1 };
    expect(seekStep({ ...base, found: true })).toBe('show');
    expect(seekStep(base)).toBe('fetch');
    expect(seekStep({ ...base, fetching: true })).toBe('wait');
    expect(seekStep({ ...base, hasNext: false })).toBe('stop');
    expect(seekStep({ ...base, failed: true })).toBe('stop');
    expect(seekStep({ ...base, pages: SEEK_PAGE_CAP })).toBe('stop');
    expect(seekStep({ ...base, pages: SEEK_PAGE_CAP - 1 })).toBe('fetch');
  });

  it('knows a reply that is still on its way, and the staff\u2019s reason when the server sends it', () => {
    expect(isLocalPost(post('local-1'))).toBe(true);
    expect(isLocalPost(post(POST))).toBe(false);
    expect(canVote(post('local-1'))).toBe(false);
    expect(reasonText('  Bitte ohne Kennzeichen. ')).toBe('Bitte ohne Kennzeichen.');
    expect(reasonText('')).toBeNull();
    expect(reasonText(null)).toBeNull();
  });
});

describe('reply cache edits (optimistic send)', () => {
  type Pages = InfiniteData<{ data: ForumPost[]; meta: { next_cursor: string | null } }, string | null>;
  const seed = (next: string | null = null) => {
    const client = new QueryClient();
    client.setQueryData<Pages>(forumKeys.posts(THREAD, 'oldest'), { pages: [{ data: [post('a'), post('c')], meta: { next_cursor: next } }], pageParams: [null] });
    return client;
  };
  const read = (client: QueryClient) => client.getQueryData<Pages>(forumKeys.posts(THREAD, 'oldest'))!.pages[0]!.data;

  it('puts an answer under its parent and a reply at the end, then swaps in the server copy', () => {
    const client = seed();
    insertPost(client, THREAD, post('local-1', { parent_id: 'a' }));
    insertPost(client, THREAD, post('local-2'));
    expect(read(client)[0]!.replies.map((reply) => reply.id)).toEqual(['local-1']);
    expect(read(client).map((entry) => entry.id)).toEqual(['a', 'c', 'local-2']);
    replacePost(client, THREAD, 'local-1', post(POST, { parent_id: 'a', status: 'pending' }));
    replacePost(client, THREAD, 'local-2', null);
    expect(read(client)[0]!.replies.map((reply) => [reply.id, reply.status])).toEqual([[POST, 'pending']]);
    expect(read(client).map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('waits for the end of the list before it shows a new top-level reply there', () => {
    const client = seed('cursor-2');
    insertPost(client, THREAD, post('local-3'));
    expect(read(client).map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('changes every loaded copy of a post (a vote)', () => {
    const client = seed();
    patchPost(client, THREAD, 'c', (current) => ({ ...current, helpful_count: current.helpful_count + 1, viewer_voted: true }));
    expect(read(client)[1]).toMatchObject({ helpful_count: 3, viewer_voted: true });
    expect(read(client)[0]).toMatchObject({ helpful_count: 2, viewer_voted: false });
  });
});

describe('notification rows (m5.8-contract §5)', () => {
  const base = (type: AppNotification['type'], extra: Partial<AppNotification> = {}): AppNotification => ({
    id: 'n1',
    type,
    group_key: `${type}:x`,
    actors: [{ username: 'lukas.sc', display_name: 'Lukas', city: null, avatar: null, is_sample: false, is_editorial: false, main_vehicle_cover: null }],
    actor_count: 1,
    vehicle: null,
    event: null,
    forum_thread: { id: THREAD, title: 'Federn für den E46 Touring', path: `/forum/${THREAD}`, is_sample: false },
    details: { thread_id: THREAD, post_id: POST, reply_to: 'thread' },
    read_at: null,
    created_at: '2026-11-16T09:00:00Z',
    ...extra,
  });

  it('words replies, mentions and solutions in German and English, with the title and never a post text', async () => {
    await i18n.changeLanguage('de');
    const t = i18n.getFixedT('de', 'home');
    expect(notificationText(base('forum_reply'), t)).toBe('@lukas.sc hat auf „Federn für den E46 Touring“ geantwortet.');
    expect(notificationText(base('forum_reply', { actor_count: 4 }), t)).toBe('@lukas.sc und 3 weitere haben auf „Federn für den E46 Touring“ geantwortet.');
    expect(notificationText(base('forum_reply', { details: { thread_id: THREAD, post_id: POST, reply_to: 'post' } }), t)).toContain('auf deine Antwort');
    expect(notificationText(base('forum_mention'), t)).toBe('@lukas.sc hat dich in „Federn für den E46 Touring“ erwähnt.');
    expect(notificationText(base('forum_solved'), t)).toBe('Deine Antwort in „Federn für den E46 Touring“ wurde als Lösung markiert.');
    const en = i18n.getFixedT('en', 'home');
    expect(notificationText(base('forum_solved'), en)).toBe('Your reply in “Federn für den E46 Touring” was marked as the solution.');
  });

  it('files them under Sozial with the chat glyph and opens the thread at the reply', () => {
    expect(notificationCategory(base('forum_reply'))).toBe('social');
    expect(matchesFilter(base('forum_solved'), 'social')).toBe(true);
    expect(notificationIcon(base('forum_mention'))).toBe('chats');
    expect(notificationTarget(base('forum_reply'), 'max.e46')).toEqual({ pathname: '/forum/[id]', params: { id: THREAD, post: POST } });
    expect(notificationTarget(base('forum_reply', { details: { thread_id: THREAD } }), 'max.e46')).toBe(`/forum/${THREAD}`);
    // A thread the reader may no longer see: the row leads nowhere.
    expect(notificationTarget(base('forum_reply', { forum_thread: null }), 'max.e46')).toBeNull();
  });
});

describe('SET-09 forum switches', () => {
  const on = { push: true, web_push: false };
  const prefs = (types: Record<string, { push: boolean; web_push: boolean }>) =>
    ({ types: { forum_reply: on, forum_mention: on, forum_solved: on, ...types }, quiet_hours: { enabled: false, from: '22:00', to: '07:00' }, message_previews: false }) as never;

  it('shows the three forum switches with the channel’s value', () => {
    expect(forumRows(prefs({}), 'push').map((row) => row.type)).toEqual(['forum_reply', 'forum_mention', 'forum_solved']);
    expect(forumRows(prefs({ forum_reply: { push: false, web_push: true } }), 'web_push')[0]).toEqual({ type: 'forum_reply', value: true });
    expect(forumRows(prefs({ forum_mention: { push: false, web_push: false } }), 'push')[1]).toEqual({ type: 'forum_mention', value: false });
    expect(forumSwitchPatch('forum_mention', 'push', false)).toEqual({ notification_prefs: { types: { forum_mention: { push: false } } } });
  });
});
