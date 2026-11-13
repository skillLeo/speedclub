import { fireEvent, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, size, space, themes, typography } from '@/theme';
import { Composer, sendsOnKey } from '@/ui/Composer';

import { flat, measureOf, renderUi, visualOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

beforeAll(hydrateThemePreference);

const base = {
  onChangeText: jest.fn(),
  placeholder: 'Nachricht schreiben',
  sendLabel: 'Senden',
  testID: 'c',
};

describe('Composer', () => {
  it.each([
    // 09 §4.3: 20 on phones below 430, 24 from 430 and on tablets and desktop.
    [360, space[20]],
    [390, space[20]],
    [430, space[24]],
    [1280, space[24]],
  ])('takes its side inset from the gutter at %i: plus on the gutter, send ending on it', async (width, gutter) => {
    (useWindowDimensions as jest.Mock).mockReturnValue({ width, height: 844, scale: 1, fontScale: 1 });
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} onAttach={jest.fn()} attachLabel="Anhängen" />);
    const root = flat(screen.getByTestId('c').props.style);
    expect(root.paddingLeft).toBe(gutter - space[12]);
    expect(root.paddingRight).toBe(gutter);
    expect(root.paddingVertical).toBe(space[8]);
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} />);
    expect(flat(screen.getByTestId('c').props.style).paddingLeft).toBe(gutter);
    (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  });

  it('disables send until there is text', async () => {
    const onSend = jest.fn();
    await renderUi(<Composer {...base} value="   " onSend={onSend} />);
    expect(visualOf('c.send').backgroundColor).toBe(themes.carbon.color.bg.raised);
    await fireEvent.press(screen.getByTestId('c.send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends the trimmed text from a 44 accent-filled circle (09 §7.8)', async () => {
    const onSend = jest.fn();
    await renderUi(<Composer {...base} value="  Servus  " onSend={onSend} />);
    expect(visualOf('c.send').width).toBe(size.touchMin);
    expect(visualOf('c.send').backgroundColor).toBe(themes.carbon.color.accent.fill);
    await fireEvent.press(screen.getByRole('button', { name: 'Senden' }));
    expect(onSend).toHaveBeenCalledWith('Servus');
  });

  it('does not send when disabled', async () => {
    const onSend = jest.fn();
    await renderUi(<Composer {...base} value="Servus" onSend={onSend} disabled />);
    await fireEvent.press(screen.getByTestId('c.send'));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('c.input').props.editable).toBe(false);
  });

  it('is a multiline field that stops growing at 5 lines, measured as drawn (a hidden line of its role, native only)', async () => {
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} />);
    const input = screen.getByTestId('c.input');
    expect(input.props.multiline).toBe(true);
    // At font scale 1 the drawn line is the role's own 24 until a measurement says otherwise.
    expect(flat(input.props.style).maxHeight).toBe(typography.input.lineHeight * size.composerMaxLines);
    expect(measureOf('c', 'line').props['aria-hidden']).toBe(true);
  });

  it('keeps padding and border out of the scrolling text, so no sixth line shows under the fifth (DQ-034)', async () => {
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} />);
    const input = flat(screen.getByTestId('c.input').props.style);
    expect(input.padding).toBe(0);
    expect(input.paddingVertical).toBeUndefined();
    expect(input.borderTopWidth).toBeUndefined();
    expect(flat(screen.getByTestId('c.box').props.style).paddingVertical).toBe(space[8]);
  });

  it('a press around the text focuses it', async () => {
    const focus = jest.fn();
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} ref={(node) => { if (node) node.focus = focus; }} />);
    await fireEvent.press(screen.getByTestId('c.field'));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('makes the field itself 44 high: one line, padding and the transparent border', async () => {
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} />);
    const box = flat(screen.getByTestId('c.box').props.style);
    const height =
      typography.input.lineHeight +
      (box.paddingVertical as number) * 2 +
      (box.borderTopWidth as number) +
      (box.borderBottomWidth as number);
    expect(height).toBe(size.composerMin);
    expect(box.borderColor).toBe('transparent');
  });

  it('shows the send in progress and ignores presses while sending', async () => {
    const onSend = jest.fn();
    await renderUi(<Composer {...base} value="Hallo" onSend={onSend} sending />);
    const send = screen.getByTestId('c.send');
    expect(send.props.accessibilityState.busy).toBe(true);
    expect(visualOf('c.send').backgroundColor).toBe(themes.carbon.color.accent.fill);
    await fireEvent.press(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('passes typed text up', async () => {
    const onChangeText = jest.fn();
    await renderUi(<Composer {...base} onChangeText={onChangeText} value="" onSend={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('c.input'), 'Hi');
    expect(onChangeText).toHaveBeenCalledWith('Hi');
  });

  it('shows the attach button only with a handler', async () => {
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} />);
    expect(screen.queryByTestId('c.attach')).toBeNull();
    const onAttach = jest.fn();
    await renderUi(<Composer {...base} value="" onSend={jest.fn()} onAttach={onAttach} attachLabel="Anhängen" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Anhängen' }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it('web keys: Enter sends; Shift+Enter and input-method Enter do not', () => {
    expect(sendsOnKey({ nativeEvent: { key: 'Enter' } })).toBe(true);
    expect(sendsOnKey({ nativeEvent: { key: 'Enter', shiftKey: true } })).toBe(false);
    expect(sendsOnKey({ nativeEvent: { key: 'Enter', isComposing: true } })).toBe(false);
    expect(sendsOnKey({ nativeEvent: { key: 'a' } })).toBe(false);
  });
});
