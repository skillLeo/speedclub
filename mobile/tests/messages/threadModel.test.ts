// Day separators and grouping (FS-7, §8), the receipt rule (02 §3.6) and the merge of server pages with the outbox.
import { dayLabel, inboxTime } from '@/features/messages/dates';
import { threadItems, type MessageItem } from '@/features/messages/grouping';
import { mergeThread, newestServerId, uniqueServerMessages } from '@/features/messages/merge';
import type { OutboxEntry } from '@/features/messages/outbox';
import { readReceiptKey, readToSend } from '@/features/messages/receipts';

import { serverMessage } from './fixtures';

const LABELS = { today: 'Heute', yesterday: 'Gestern' };
// Sunday 8 November 2026, 11:00 in Berlin.
const NOW = new Date('2026-11-08T10:00:00Z');

describe('day labels in Europe/Berlin', () => {
  it('says Heute and Gestern, then the short weekday and date', () => {
    expect(dayLabel(new Date('2026-11-08T06:00:00Z'), NOW, 'de', LABELS)).toBe('Heute');
    expect(dayLabel(new Date('2026-11-07T23:30:00Z'), NOW, 'de', LABELS)).toBe('Heute');
    expect(dayLabel(new Date('2026-11-07T12:00:00Z'), NOW, 'de', LABELS)).toBe('Gestern');
    expect(dayLabel(new Date('2026-11-03T12:00:00Z'), NOW, 'de', LABELS)).toBe('Di., 3. Nov.');
    expect(dayLabel(new Date('2026-11-03T12:00:00Z'), NOW, 'en', { today: 'Today', yesterday: 'Yesterday' })).toBe('Tue 3 Nov');
  });

  it('adds the year for an earlier year', () => {
    expect(dayLabel(new Date('2025-11-03T12:00:00Z'), NOW, 'de', LABELS)).toBe('Mo., 3. Nov. 2025');
  });

  it('counts Berlin days across the change to winter time', () => {
    // 25 Oct 2026 is the DST change; the 24th at 23:30 Berlin (21:30Z) is still the 24th.
    expect(dayLabel(new Date('2026-10-24T21:30:00Z'), new Date('2026-10-25T10:00:00Z'), 'de', LABELS)).toBe('Gestern');
  });

  it('keeps inbox times short', () => {
    expect(inboxTime(new Date('2026-11-08T08:05:00Z'), NOW, 'de', 'Gestern')).toBe('09:05');
    expect(inboxTime(new Date('2026-11-07T08:05:00Z'), NOW, 'de', 'Gestern')).toBe('Gestern');
    expect(inboxTime(new Date('2026-11-04T08:05:00Z'), NOW, 'de', 'Gestern')).toBe('Mi');
    expect(inboxTime(new Date('2026-10-20T08:05:00Z'), NOW, 'de', 'Gestern')).toBe('20.10.26');
  });
});

describe('thread items', () => {
  const messages = [
    serverMessage({ id: '05', mine: true, senderUsername: null, createdAt: '2026-11-08T09:20:00Z' }),
    serverMessage({ id: '04', mine: true, senderUsername: null, createdAt: '2026-11-08T09:17:00Z' }),
    serverMessage({ id: '03', createdAt: '2026-11-08T09:16:00Z' }),
    serverMessage({ id: '02', createdAt: '2026-11-08T09:00:00Z' }),
    serverMessage({ id: '01', createdAt: '2026-11-07T18:00:00Z' }),
  ];
  const items = threadItems(messages, NOW, 'de', LABELS);

  it('puts a separator above the first message of each day (after it in the inverted list)', () => {
    expect(items.map((item) => (item.type === 'day' ? item.label : item.key))).toEqual(['05', '04', '03', '02', 'Heute', '01', 'Gestern']);
  });

  it('groups the same side within 5 minutes; the tail and time go to the newest bubble of a group', () => {
    const byKey = Object.fromEntries(items.filter((item): item is MessageItem => item.type === 'message').map((item) => [item.key, item]));
    expect(byKey['05']).toMatchObject({ groupStart: false, groupEnd: true });
    expect(byKey['04']).toMatchObject({ groupStart: true, groupEnd: false });
    // 16 minutes apart: two groups.
    expect(byKey['03']).toMatchObject({ groupStart: true, groupEnd: true });
    expect(byKey['02']).toMatchObject({ groupStart: true, groupEnd: true });
  });

  it('a failed message ends its group', () => {
    const failed = { ...serverMessage({ id: 'x', mine: true, senderUsername: null, createdAt: '2026-11-08T09:21:00Z' }), id: null, key: 'c-1', delivery: 'failed' as const };
    const grouped = threadItems([failed, ...messages], NOW, 'de', LABELS);
    expect(grouped[0]!).toMatchObject({ key: 'c-1', groupStart: true, groupEnd: true });
    expect(grouped[1]!).toMatchObject({ key: '05', groupEnd: true });
  });
});

describe('read receipts', () => {
  const thread = [
    serverMessage({ id: '01', mine: true, senderUsername: null }),
    serverMessage({ id: '02' }),
    serverMessage({ id: '03', mine: true, senderUsername: null }),
  ];

  it('shows Gelesen under the last own message only, once the other side read it', () => {
    expect(readReceiptKey({ folder: 'chats', otherReadMessageId: '03', messages: thread })).toBe('03');
    expect(readReceiptKey({ folder: 'chats', otherReadMessageId: '04', messages: thread })).toBe('03');
    expect(readReceiptKey({ folder: 'chats', otherReadMessageId: '02', messages: thread })).toBeNull();
  });

  it('shows nothing when receipts do not apply (both must send them: the server sends null)', () => {
    expect(readReceiptKey({ folder: 'chats', otherReadMessageId: null, messages: thread })).toBeNull();
  });

  it('never shows read state in a request, whatever the answer says', () => {
    expect(readReceiptKey({ folder: 'requests', otherReadMessageId: '09', messages: thread })).toBeNull();
  });

  it('shows nothing while a newer own message is still on its way', () => {
    const pending = { ...serverMessage({ id: 'p', mine: true, senderUsername: null, createdAt: '2026-11-08T11:00:00Z' }), id: null, key: 'c-9', delivery: 'sending' as const };
    expect(readReceiptKey({ folder: 'chats', otherReadMessageId: '03', messages: [pending, ...thread] })).toBeNull();
  });

  it('marks read only outside requests, only when visible, and only forward', () => {
    expect(readToSend({ folder: 'chats', newestId: '05', lastSentId: '03', visible: true })).toBe('05');
    expect(readToSend({ folder: 'archived', newestId: '05', lastSentId: null, visible: true })).toBe('05');
    expect(readToSend({ folder: 'chats', newestId: '05', lastSentId: '05', visible: true })).toBeNull();
    expect(readToSend({ folder: 'chats', newestId: '05', lastSentId: null, visible: false })).toBeNull();
    expect(readToSend({ folder: 'requests', newestId: '05', lastSentId: null, visible: true })).toBeNull();
  });
});

describe('merging server pages with the outbox', () => {
  const entry = (clientId: string, seq: number, state: OutboxEntry['state'], createdAt = '2026-11-08T10:00:00Z'): OutboxEntry => ({
    clientId,
    idempotencyKey: `key-${clientId}`,
    conversationId: 'c1',
    draft: { kind: 'text', body: clientId },
    createdAt,
    seq,
    state,
    failure: state === 'failed' ? { reason: 'invalid', message: 'nein' } : null,
    attempts: 1,
  });

  it('keeps one copy of a message that came from a page and from a poll, with the newer reactions', () => {
    const first = serverMessage({ id: '02' });
    const again = { ...first, reactions: [{ key: 'fire' as const, count: 1, mine: false }] };
    const unique = uniqueServerMessages([[first, serverMessage({ id: '01' })], [again]]);
    expect(unique.map((message) => message.id)).toEqual(['02', '01']);
    expect(unique[0]!.reactions).toHaveLength(1);
    expect(newestServerId(unique)).toBe('02');
  });

  it('drops an outbox entry the server already returned (dedupe on client_id)', () => {
    const server = [serverMessage({ id: '03', clientId: 'c-a', mine: true }), serverMessage({ id: '02' })];
    const merged = mergeThread(server, [entry('c-a', 1, 'sending'), entry('c-b', 2, 'queued')]);
    expect(merged.map((message) => message.key)).toEqual(['c-b', '03', '02']);
  });

  it('puts messages on their way at the newest end in written order, and a failed one where it was written', () => {
    const server = [serverMessage({ id: '03', createdAt: '2026-11-08T10:05:00Z' }), serverMessage({ id: '01', createdAt: '2026-11-08T09:55:00Z' })];
    const merged = mergeThread(server, [entry('c-1', 1, 'failed', '2026-11-08T10:00:00Z'), entry('c-2', 2, 'sending'), entry('c-3', 3, 'queued')]);
    expect(merged.map((message) => message.key)).toEqual(['c-3', 'c-2', '03', 'c-1', '01']);
    expect(merged.find((message) => message.key === 'c-1')?.delivery).toBe('failed');
  });
});
