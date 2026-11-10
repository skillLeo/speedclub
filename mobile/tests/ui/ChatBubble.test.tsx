import { screen } from '@testing-library/react-native';
import { Pressable } from 'react-native';

import { hydrateThemePreference, size, themes, typography } from '@/theme';
import { ChatBubble } from '@/ui/ChatBubble';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('ChatBubble', () => {
  it('own: right on bg.inverse with the tail bottom right', async () => {
    await renderUi(<ChatBubble own text="Servus" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).alignSelf).toBe('flex-end');
    const bubble = flat(screen.getByTestId('b.bubble').props.style);
    expect(bubble.backgroundColor).toBe(themes.carbon.color.bg.inverse);
    expect(bubble.borderRadius).toBe(size.bubbleRadius);
    expect(bubble.borderBottomRightRadius).toBe(size.bubbleTailRadius);
    const text = flat(screen.getByText('Servus').props.style);
    expect(text.color).toBe(themes.carbon.color.text.inverse);
    expect(text.fontSize).toBe(typography.bodyDense.fontSize);
  });

  it('other: left on bg.raised with the tail bottom left', async () => {
    await renderUi(<ChatBubble text="Hallo" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).alignSelf).toBe('flex-start');
    const bubble = flat(screen.getByTestId('b.bubble').props.style);
    expect(bubble.backgroundColor).toBe(themes.carbon.color.bg.raised);
    expect(bubble.borderBottomLeftRadius).toBe(size.bubbleTailRadius);
    expect(flat(screen.getByText('Hallo').props.style).color).toBe(themes.carbon.color.text.primary);
  });

  it('is at most 75 % wide', async () => {
    await renderUi(<ChatBubble text="Hallo" testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).maxWidth).toBe('75%');
  });

  it('inside a group the corner stays round', async () => {
    await renderUi(<ChatBubble own tail={false} text="Hallo" testID="b" />);
    expect(flat(screen.getByTestId('b.bubble').props.style).borderBottomRightRadius).toBeUndefined();
  });

  it('shows the time in caption tertiary under the bubble', async () => {
    await renderUi(<ChatBubble text="Hallo" time="14:32" testID="b" />);
    const time = flat(screen.getByTestId('b.time').props.style);
    expect(time.fontSize).toBe(typography.caption.fontSize);
    expect(time.color).toBe(themes.carbon.color.text.tertiary);
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
