/** M2.8 round 3: on web an inactive tab stays laid out, hidden, so nothing in it lays out at 0 × 0 and re-creates its photos. */
import { render, screen } from '@testing-library/react-native';
import type { TabsDescriptor } from 'expo-router/ui';
import { StyleSheet, View } from 'react-native';

import { renderTabSlot, updatePane } from '@/features/shell/tabSlotRender';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));

const descriptor = (name: string, options: Record<string, unknown> = {}) =>
  ({
    route: { key: `${name}-key`, name },
    options,
    render: () => <View testID={`${name}.content`} />,
  }) as unknown as TabsDescriptor;

const options = (isFocused: boolean, loaded = true) => ({ index: 0, isFocused, loaded, detachInactiveScreens: false });

describe('renderTabSlot on web', () => {
  it('keeps an inactive tab mounted and laid out: hidden by visibility, never display none', async () => {
    await render(
      <>
        {renderTabSlot(descriptor('home'), options(false))}
        {renderTabSlot(descriptor('discover'), options(true))}
      </>,
    );
    const hidden = StyleSheet.flatten(screen.getByTestId('shell.tab.home', { includeHiddenElements: true }).props.style);
    expect(hidden.display).toBeUndefined();
    expect(hidden).toMatchObject({ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' });
    // Below the shown pane, so no browser routes a wheel into it (WebKit, verify run 3).
    expect(hidden.zIndex).toBe(-1);
    expect(screen.getByTestId('home.content', { includeHiddenElements: true })).toBeTruthy();
    const shown = StyleSheet.flatten(screen.getByTestId('shell.tab.discover').props.style);
    expect(shown.visibility).toBeUndefined();
    expect(shown.position).toBe('relative');
  });

  it('a lazy tab that was never opened is not rendered, nor one that unmounts on blur', async () => {
    expect(renderTabSlot(descriptor('garage'), options(false, false))).toBeNull();
    expect(renderTabSlot(descriptor('profile', { unmountOnBlur: true }), options(false))).toBeNull();
  });
});

describe('focus across a tab switch on web (code review S1)', () => {
  const body = { tag: 'body' };
  const pane = (inside: unknown[] = []) => ({ inert: false, focus: jest.fn(), contains: (node: unknown) => inside.includes(node) });
  const now = (task: () => void) => task();

  it('the pane left behind turns inert and remembers its focused element; shown again, it gives that element the focus back', () => {
    const button = { focus: jest.fn(), isConnected: true };
    const home = pane([button]);
    const memory = { focused: null as boolean | null, remembered: null };
    const doc = { activeElement: button as unknown, body };
    updatePane(home, true, memory, doc, now);
    expect(home.inert).toBe(false);
    // A button in Start switches tabs: Start turns inert, and the browser drops the focus on <body>.
    updatePane(home, false, memory, doc, now);
    expect(home.inert).toBe(true);
    doc.activeElement = body;
    updatePane(home, true, memory, doc, now);
    expect(home.inert).toBe(false);
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('a pane shown for the first time takes the focus out of an inert pane, but leaves a page start on <body> alone', () => {
    const discover = pane();
    const inInert = { closest: (selector: string) => (selector === '[inert]' ? {} : null) };
    updatePane(discover, true, { focused: null, remembered: null }, { activeElement: inInert, body }, now);
    expect(discover.focus).toHaveBeenCalledWith({ preventScroll: true });
    const fresh = pane();
    updatePane(fresh, true, { focused: null, remembered: null }, { activeElement: body, body }, now);
    expect(fresh.focus).not.toHaveBeenCalled();
  });

  it('focus held outside the panes (the tab bar button that was pressed) stays where it is', () => {
    const garage = pane();
    const tabButton = { closest: () => null };
    updatePane(garage, true, { focused: false, remembered: null }, { activeElement: tabButton, body }, now);
    expect(garage.focus).not.toHaveBeenCalled();
  });
});
