import { screen } from '@testing-library/react-native';
import { Pressable } from 'react-native';

import { bubble as bubbleTokens, hydrateThemePreference, themes, typography } from '@/theme';
import { ChatBubble, invertedListMirror, sendMorphStart } from '@/ui/ChatBubble';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 1, fontScale: 1 })),
}));

beforeAll(hydrateThemePreference);

describe('ChatBubble', () => {
  it('own: right on bubble.own, radius 20 all round, no tail (09 §7.8)', async () => {
    await renderUi(<ChatBubble own text="Servus" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).alignSelf).toBe('flex-end');
    const bubble = flat(screen.getByTestId('b.bubble').props.style);
    expect(bubble.backgroundColor).toBe(themes.carbon.color.bubble.ownBg);
    expect(bubble.borderRadius).toBe(bubbleTokens.radius);
    expect(bubble.borderBottomRightRadius).toBeUndefined();
    const text = flat(screen.getByText('Servus').props.style);
    expect(text.color).toBe(themes.carbon.color.bubble.ownText);
    expect(text.fontSize).toBe(typography.body.fontSize);
  });

  it('other: left on bubble.other', async () => {
    await renderUi(<ChatBubble text="Hallo" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).alignSelf).toBe('flex-start');
    const bubble = flat(screen.getByTestId('b.bubble').props.style);
    expect(bubble.backgroundColor).toBe(themes.carbon.color.bubble.otherBg);
    expect(bubble.borderBottomLeftRadius).toBeUndefined();
    expect(flat(screen.getByText('Hallo').props.style).color).toBe(themes.carbon.color.bubble.otherText);
  });

  it('grouped: the joined corners on the sender side reduce to concentric(20, 12 + 2) = 6', async () => {
    await renderUi(<ChatBubble own groupStart={false} groupEnd={false} text="Mitte" testID="b" />);
    const mid = flat(screen.getByTestId('b.bubble').props.style);
    expect(mid.borderTopRightRadius).toBe(6);
    expect(mid.borderBottomRightRadius).toBe(6);
    expect(mid.borderTopLeftRadius).toBeUndefined();
  });

  it('grouped other: first joins at the bottom left only', async () => {
    await renderUi(<ChatBubble groupEnd={false} text="Erste" testID="b" />);
    const first = flat(screen.getByTestId('b.bubble').props.style);
    expect(first.borderBottomLeftRadius).toBe(6);
    expect(first.borderTopLeftRadius).toBeUndefined();
  });

  it('is at most 75 % wide', async () => {
    await renderUi(<ChatBubble text="Hallo" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).maxWidth).toBe('75%');
  });

  it('shows the time in caption text.secondary under the bubble (token rule: never tertiary on bubbles)', async () => {
    await renderUi(<ChatBubble text="Hallo" time="14:32" testID="b" />);
    const time = flat(screen.getByTestId('b.time').props.style);
    expect(time.fontSize).toBe(typography.caption.fontSize);
    expect(time.color).toBe(themes.carbon.color.text.secondary);
  });

  it('SM12: the morph starts centred on the composer, scaled to its width within [1/3, 1]', () => {
    const start = sendMorphStart({ x: 20, y: 700, width: 300, height: 44 }, { x: 200, y: 600, width: 150, height: 40 });
    expect(start).toEqual({ dx: 20 + 150 - (200 + 75), dy: 722 - 620, scale: 1 });
    expect(sendMorphStart({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 300, height: 40 }).scale).toBeCloseTo(1 / 3);
  });

  it('an inverted list mirrors y everywhere and x on Android only', () => {
    expect(invertedListMirror(false, true)).toEqual({ x: 1, y: 1 });
    expect(invertedListMirror(true, false)).toEqual({ x: 1, y: -1 });
    expect(invertedListMirror(true, true)).toEqual({ x: -1, y: -1 });
  });

  it('renders a morph from the composer', async () => {
    await renderUi(<ChatBubble own text="Neu" animateIn enterFrom={{ x: 0, y: 0, width: 200, height: 44 }} invertedList testID="b" />);
    expect(screen.getByText('Neu')).toBeTruthy();
  });

  it('native: merges sender, message and time into one readable element', async () => {
    await renderUi(<ChatBubble text="Hallo" time="14:32" senderLabel="Lukas" testID="b" />);
    const group = screen.getByTestId('b');
    expect(group.props.accessible).toBe(true);
    expect(group.props['aria-label']).toBe('Lukas, Hallo, 14:32');
  });

  it('native: a bubble with content stays unmerged, so the content can be reached and the text names the sender', async () => {
    await renderUi(
      <ChatBubble text="Hallo" time="14:32" senderLabel="Lukas" testID="b">
        <Pressable role="button" aria-label="Fahrzeug öffnen" testID="b.shared" />
      </ChatBubble>,
    );
    expect(screen.getByTestId('b').props.accessible).toBeUndefined();
    expect(screen.getByTestId('b').props['aria-label']).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Fahrzeug öffnen' })).toBeTruthy();
    expect(screen.getByText('Hallo').props['aria-label']).toBe('Lukas, Hallo');
    expect(screen.getByTestId('b.time')).toHaveTextContent('14:32');
  });

  it('without a sender the children stay separate', async () => {
    await renderUi(<ChatBubble text="Hallo" testID="b" />);
    expect(screen.getByTestId('b').props.accessible).toBeUndefined();
  });

  it('renders when it animates in', async () => {
    await renderUi(<ChatBubble own text="Neu" animateIn testID="b" />);
    expect(screen.getByText('Neu')).toBeTruthy();
  });
});
