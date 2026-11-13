/** M4.11 (09 §8.5–§8.6): the pure parts of the composer, VEH-05 and the cache edits. */
import { deepEdit, canEditUpdate } from '@/api/queries/social2';
import type { UploadItem } from '@/state/uploads';
import {
  activeMention,
  composerIssues,
  insertMention,
  mentionSegments,
  pairsByMedia,
  pairsWithout,
  parseDay,
  parseMileage,
  tapForPair,
  unpairedPhotos,
  updatePairs,
} from '@/features/updates/model';
import { settledChange } from '@/features/updates/pairing';

import { R34 } from './fixtures';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

describe('@mention editing', () => {
  it('finds the mention at the caret only after a space or at the start', () => {
    expect(activeMention('Danke @lu', 9)).toEqual({ start: 6, query: 'lu' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('mail@lukas', 10)).toBeNull();
    expect(activeMention('Danke @lukas sc', 15)).toBeNull();
    expect(activeMention('(@max', 5)).toEqual({ start: 1, query: 'max' });
  });

  it('replaces the typed name with the chosen member and puts the caret after it', () => {
    expect(insertMention('Danke @lu für die Hilfe', { start: 6, query: 'lu' }, 'lukas.sc')).toEqual({
      text: 'Danke @lukas.sc für die Hilfe',
      caret: 16,
    });
    expect(insertMention('@ma', { start: 0, query: 'ma' }, 'max.e46')).toEqual({
      text: '@max.e46 ',
      caret: 9,
    });
  });

  it('links only the members the API resolved; a full stop ends the name', () => {
    expect(mentionSegments('Abstimmung mit @lukas.sc. Danke @nobody', ['lukas.sc'])).toEqual([
      { kind: 'text', text: 'Abstimmung mit ' },
      { kind: 'mention', text: '@lukas.sc', username: 'lukas.sc' },
      { kind: 'text', text: '. Danke @nobody' },
    ]);
    expect(mentionSegments('keine', [])).toEqual([{ kind: 'text', text: 'keine' }]);
    expect(mentionSegments('mail@lukas.sc', ['lukas.sc'])).toEqual([{ kind: 'text', text: 'mail@lukas.sc' }]);
  });
});

describe('before/after pairs', () => {
  it('builds a pair from two taps and takes it apart with a third on one of them', () => {
    let state = tapForPair([], null, 2);
    expect(state).toEqual({ pairs: [], pending: 2 });
    state = tapForPair(state.pairs, state.pending, 0);
    expect(state.pairs).toEqual([{ before: 2, after: 0 }]);
    expect(tapForPair(state.pairs, null, 0)).toEqual({ pairs: [], pending: null });
    // The same photo twice cancels the pending one.
    expect(tapForPair([], 3, 3)).toEqual({ pairs: [], pending: null });
  });

  it('drops a pair with a removed photo and moves later positions up', () => {
    expect(
      pairsWithout(
        [
          { before: 0, after: 1 },
          { before: 2, after: 3 },
        ],
        1,
      ),
    ).toEqual([{ before: 1, after: 2 }]);
  });

  it('turns local pairs into media id pairs, leaving out pairs whose upload failed', () => {
    expect(
      pairsByMedia(
        [
          { before: 0, after: 1 },
          { before: 2, after: 3 },
        ],
        ['a', 'b', null, 'd'],
      ),
    ).toEqual([['a', 'b']]);
  });

  it('shows only pairs whose photos both have a file, the rest as single photos', () => {
    const [first, second, third] = R34.photos;
    const update = {
      photos: [first!, second!, { ...third!, variants: [] }],
      photo_pairs: [
        { before: first!.id, after: second!.id },
        { before: second!.id, after: third!.id },
      ],
    };
    expect(updatePairs(update).map((pair) => [pair.before.id, pair.after.id])).toEqual([
      [first!.id, second!.id],
    ]);
    expect(unpairedPhotos(update)).toEqual([]);
  });
});

describe('composer validation', () => {
  const base = { text: 'Neues Fahrwerk drin.', photoCount: 0, mileage: '', date: '14.06.2026' };
  it('needs text or a photo', () => {
    expect(composerIssues({ ...base, text: '  ' }, '2026-07-01')).toEqual({ text: 'empty' });
    expect(composerIssues({ ...base, text: '', photoCount: 1 }, '2026-07-01')).toEqual({});
  });
  it('checks length, mileage and date like the API', () => {
    expect(composerIssues({ ...base, text: 'x'.repeat(2001) }, '2026-07-01').text).toBe('textTooLong');
    expect(composerIssues({ ...base, mileage: '12a' }, '2026-07-01').mileage).toBe('mileageInvalid');
    expect(composerIssues({ ...base, date: '31.02.2026' }, '2026-07-01').date).toBe('dateInvalid');
    expect(composerIssues({ ...base, date: '15.06.2026' }, '2026-06-14').date).toBe('dateFuture');
  });
  it('reads German numbers and dates', () => {
    expect(parseMileage('48.200')).toBe(48200);
    expect(parseMileage('')).toBeNull();
    expect(parseMileage('2.000.001')).toBeUndefined();
    expect(parseDay('1.6.2026')).toBe('2026-06-01');
    expect(parseDay('2026-06-14')).toBe('2026-06-14');
    expect(parseDay('')).toBeNull();
  });
});

describe('photos after the post', () => {
  const item = (id: string, status: UploadItem['status'], mediaId: string | null, retryable = true) =>
    ({ id, status, mediaId, retryable }) as UploadItem;
  const post = { updateId: 'u1', slug: 's', itemIds: ['q1', 'q2', 'q3'], pairs: [{ before: 0, after: 2 }] };

  it('waits while a photo is still on its way', () => {
    expect(
      settledChange(post, [
        item('q1', 'done', 'm1'),
        item('q2', 'uploading', null),
        item('q3', 'done', 'm3'),
      ]),
    ).toBeNull();
    expect(
      settledChange(post, [
        item('q1', 'done', 'm1'),
        item('q2', 'failed', null, true),
        item('q3', 'done', 'm3'),
      ]),
    ).toBeNull();
  });

  it('sends the picked order and the pairs once everything settled', () => {
    expect(
      settledChange(post, [
        item('q3', 'done', 'm3'),
        item('q1', 'done', 'm1'),
        item('q2', 'failed', null, false),
      ]),
    ).toEqual({
      photo_order: ['m1', 'm3'],
      photo_pairs: [['m1', 'm3']],
    });
  });
});

describe('cache edits', () => {
  it('changes only the matching nodes and keeps every untouched branch', () => {
    const untouched = { id: 'x', my_reaction: null, photo_pairs: [] };
    const data = { pages: [{ data: [{ id: 'a', my_reaction: null, photo_pairs: [] }, untouched] }] };
    const next = deepEdit(
      data,
      (node) => node.id === 'a' && 'photo_pairs' in node,
      (node) => ({ ...node, my_reaction: 'low' }),
    ) as typeof data;
    expect(next.pages[0]!.data[0]).toEqual({ id: 'a', my_reaction: 'low', photo_pairs: [] });
    expect(next.pages[0]!.data[1]).toBe(untouched);
    expect(
      deepEdit(
        data,
        () => false,
        (node) => node,
      ),
    ).toBe(data);
  });

  it('opens the edit window for 24 hours only', () => {
    expect(
      canEditUpdate({ editable_until: '2026-06-14T12:00:00Z' }, Date.parse('2026-06-14T11:00:00Z')),
    ).toBe(true);
    expect(
      canEditUpdate({ editable_until: '2026-06-14T12:00:00Z' }, Date.parse('2026-06-14T13:00:00Z')),
    ).toBe(false);
    expect(canEditUpdate({ editable_until: null })).toBe(false);
  });
});
