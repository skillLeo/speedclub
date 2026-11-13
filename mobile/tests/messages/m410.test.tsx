/**
 * M4.10 MSG 2.0: reactions without emoji, the bubble at large text (DQ-939), swipe-to-reply maths and the reply quote on the wire,
 * the car badge read, the SM12 send origin, and the empty inbox's sample preview (DQ-1033).
 */
import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { readCarCover, readReplyTo } from '@/api/queries/messaging';
import { BubbleQuote, ReplyBar } from '@/features/messages/components/ReplyQuote';
import { PICKER_KEYS, REACTION_GLYPH, ReactionChips, ReactionPicker } from '@/features/messages/components/Reactions';
import { SampleConversations } from '@/features/messages/components/SampleConversations';
import { REACTION_KEYS } from '@/features/messages/model';
import { entryToMessage, type OutboxEntry } from '@/features/messages/outbox';
import { __resetSendOriginsForTests, rememberSendOrigin, SEND_ORIGIN_TTL_MS, sendOriginFor } from '@/features/messages/sendMorph';
import { hydrateThemePreference } from '@/theme';
import { ChatBubble } from '@/ui/ChatBubble';
import { replyOffset } from '@/ui/motion/math';
import { REPLY_THRESHOLD } from '@/ui/motion/SwipeReply';

import { flat, renderUi } from '../ui/helpers';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 1, fontScale: 1 })),
}));
const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  dimensions.mockReturnValue({ width: 393, height: 852, scale: 1, fontScale: 1 });
  __resetSendOriginsForTests();
});

/** Any pictograph or emoji presentation character. */
const EMOJI = /\p{Extended_Pictographic}/u;

describe('MSG-02 reactions (no emoji, 09 §7.8)', () => {
  it('maps every picker key to a glyph and offers only keys the API takes', () => {
    expect(PICKER_KEYS[0]).toBe('heart');
    for (const key of PICKER_KEYS) {
      expect(REACTION_KEYS).toContain(key);
      expect(REACTION_GLYPH[key]).toBeDefined();
    }
  });

  it('the picker draws no emoji character', async () => {
    await renderUi(<ReactionPicker mine="heart" onPick={jest.fn()} testID="p" />);
    expect(screen.getByLabelText('Reaktion entfernen')).toBeTruthy();
    expect(screen.getByTestId('p.thumbs_up')).toBeTruthy();
    expect(screen.queryByTestId('p.fire')).toBeNull();
    expect(screen.toJSON() ? JSON.stringify(screen.toJSON()) : '').not.toMatch(EMOJI);
  });

  it('a v1 reaction without a glyph shows its word, never the emoji', async () => {
    await renderUi(
      <ReactionChips
        reactions={[
          { key: 'fire', count: 2, mine: false },
          { key: 'heart', count: 1, mine: true },
        ]}
        onToggle={jest.fn()}
        testID="c"
      />,
    );
    expect(screen.getByTestId('c.fire')).toHaveTextContent(/Feuer/);
    expect(JSON.stringify(screen.toJSON())).not.toMatch(EMOJI);
    expect(screen.getByLabelText('Gefällt mir: 1, deine Reaktion')).toBeTruthy();
  });
});

describe('DQ-939: a bubble at large text', () => {
  it('stays at 75 % at 100 % text', async () => {
    await renderUi(<ChatBubble text="Mönchengladbach" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).maxWidth).toBe('75%');
  });

  it('may take the whole column from font scale 1.5', async () => {
    dimensions.mockReturnValue({ width: 393, height: 852, scale: 1, fontScale: 2 });
    await renderUi(<ChatBubble text="Mönchengladbach" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).maxWidth).toBe('100%');
  });
});

describe('swipe-to-reply (SM11)', () => {
  it('follows the finger to the threshold, then rubber-bands, never to the left', () => {
    expect(replyOffset(-40, REPLY_THRESHOLD, 393, 0.55)).toBe(0);
    expect(replyOffset(30, REPLY_THRESHOLD, 393, 0.55)).toBe(30);
    const past = replyOffset(REPLY_THRESHOLD + 100, REPLY_THRESHOLD, 393, 0.55);
    expect(past).toBeGreaterThan(REPLY_THRESHOLD);
    expect(past).toBeLessThan(REPLY_THRESHOLD + 100);
  });

  it('reads reply_to only when the server sends a valid one', () => {
    expect(readReplyTo({ id: 'm' })).toBeNull();
    expect(readReplyTo({ reply_to: null })).toBeNull();
    expect(readReplyTo({ reply_to: { id: 'r1', type: 'gif', is_mine: true } })).toBeNull();
    expect(readReplyTo({ reply_to: { id: 'r1', type: 'text', body: 'Welche Federn?', is_mine: false } })).toEqual({
      id: 'r1',
      kind: 'text',
      mine: false,
      excerpt: 'Welche Federn?',
    });
  });

  it('the optimistic bubble keeps the quote of its draft', () => {
    const entry = {
      clientId: 'c1',
      idempotencyKey: 'k1',
      conversationId: 'conv',
      draft: { kind: 'text', body: 'KW V3', replyTo: { id: 'r1', kind: 'text', mine: false, excerpt: 'Welche Federn?' } },
      createdAt: '2026-11-12T10:00:00.000Z',
      seq: 1,
      state: 'sending',
      failure: null,
      attempts: 0,
    } as unknown as OutboxEntry;
    expect(entryToMessage(entry).replyTo?.id).toBe('r1');
  });

  it('quote bar and bubble quote name who and what', async () => {
    const quote = { id: 'r1', kind: 'photo' as const, mine: false, excerpt: null };
    await renderUi(<ReplyBar quote={quote} otherName="Kenji" gutter={20} onCancel={jest.fn()} testID="r" />);
    expect(screen.getByText('Antwort an Kenji')).toBeTruthy();
    expect(screen.getByTestId('r.text')).toHaveTextContent('Foto');
    expect(screen.getByLabelText('Antwort verwerfen')).toBeTruthy();
    await renderUi(<BubbleQuote quote={{ ...quote, kind: 'text', mine: true, excerpt: 'Samstag?' }} otherName="Kenji" own testID="q" />);
    expect(screen.getByTestId('q')).toHaveTextContent(/DuSamstag\?/);
  });
});

describe('car badge (09 §7.8)', () => {
  it('reads main_vehicle_cover only when present and shaped like media', () => {
    expect(readCarCover({ username: 'a' })).toBeNull();
    expect(readCarCover({ main_vehicle_cover: 'x' })).toBeNull();
    const cover = { id: 'm', variants: [], blurhash: null };
    expect(readCarCover({ main_vehicle_cover: cover })).toBe(cover);
  });
});

describe('SM12 send origin', () => {
  it('is there for the moment of sending only', () => {
    const rect = { x: 20, y: 760, width: 300, height: 44 };
    rememberSendOrigin('c1', rect, 1_000);
    expect(sendOriginFor('c1', 1_200)).toEqual(rect);
    expect(sendOriginFor('c1', 1_000 + SEND_ORIGIN_TTL_MS + 1)).toBeNull();
    expect(sendOriginFor(null, 1_000)).toBeNull();
    rememberSendOrigin('c2', null, 1_000);
    expect(sendOriginFor('c2', 1_000)).toBeNull();
  });
});

describe('MSG-01 empty preview (DQ-1033)', () => {
  it('shows two sample rows, each badged "Beispiel", hidden from readers', async () => {
    await renderUi(<SampleConversations testID="s" />);
    const root = screen.getByTestId('s', { includeHiddenElements: true });
    expect(root.props['aria-hidden']).toBe(true);
    expect(screen.getAllByText('Beispiel', { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getByText('Welche Federn fährst du an der Hinterachse?', { includeHiddenElements: true })).toBeTruthy();
  });
});
