/**
 * The search bar on web. After cancel the bar itself holds focus: a named landmark, no tab stop, and what a keyboard user does
 * there reaches the field (DQ-097). Clear opens the bar only when focus arrives by keyboard (DQ-098).
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { createRef, type ComponentRef } from 'react';
import type { TextInput } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { SearchBar } from '@/ui/SearchBar';

import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

beforeAll(hydrateThemePreference);

const props = { placeholder: 'Marke, Modell, Mods oder Mitglieder', testID: 's', value: '', onChangeText: jest.fn() };
const ROOT = 's.focusAnchor';

/** A keydown as react-native-web hands it over. */
function keyDown(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}, own = true) {
  const host = {};
  return { target: own ? host : {}, currentTarget: host, preventDefault: jest.fn(), nativeEvent: { key, ...modifiers } };
}

async function open() {
  const ref = createRef<ComponentRef<typeof TextInput>>();
  await renderUi(<SearchBar {...props} ref={ref} />);
  const focus = jest.fn();
  if (ref.current) ref.current.focus = focus;
  return focus;
}

describe('SearchBar on web', () => {
  it('its root is a search landmark named by the placeholder, out of the tab order', async () => {
    await open();
    const root = screen.getByTestId(ROOT);
    expect(root.props.role).toBe('search');
    expect(root.props['aria-label']).toBe(props.placeholder);
    expect(root.props.tabIndex).toBe(-1);
  });

  it.each(['Enter', ' '])('key %j on the root opens the field and is not taken for text or a scroll', async (key) => {
    const focus = await open();
    const event = keyDown(key);
    await fireEvent(screen.getByTestId(ROOT), 'keyDown', event);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('a typed character opens the field and goes on into it', async () => {
    const focus = await open();
    const event = keyDown('S');
    await fireEvent(screen.getByTestId(ROOT), 'keyDown', event);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves shortcuts, other keys and keys from inside the bar alone', async () => {
    const focus = await open();
    for (const event of [keyDown('c', { ctrlKey: true }), keyDown('k', { metaKey: true }), keyDown('Enter', { altKey: true }), keyDown('Escape'), keyDown('ArrowDown'), keyDown('S', {}, false)]) {
      await fireEvent(screen.getByTestId(ROOT), 'keyDown', event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(focus).not.toHaveBeenCalled();
  });

  it('Tab does not open the field and keeps its default', async () => {
    const focus = await open();
    const event = keyDown('Tab');
    await fireEvent(screen.getByTestId(ROOT), 'keyDown', event);
    expect(focus).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('clear opens the bar on keyboard focus only, because a pointer press would move it away', async () => {
    await renderUi(<SearchBar {...props} value="BMW" />);
    await fireEvent(screen.getByTestId('s.clear'), 'focus', { target: { matches: () => false } });
    expect(screen.queryByTestId('s.cancel')).toBeNull();
    await fireEvent(screen.getByTestId('s.clear'), 'focus', { target: { matches: (selector: string) => selector === ':focus-visible' } });
    expect(screen.queryByTestId('s.cancel')).not.toBeNull();
  });

  describe('focus in the empty part of the bar', () => {
    const outside = {};
    const globals = globalThis as unknown as { document?: unknown; Node?: unknown };

    beforeEach(() => {
      // contains() asks for a DOM node and the document for where focus went; nothing outside the bar is one of its nodes.
      globals.Node = class {};
      globals.document = { activeElement: outside };
    });
    afterEach(() => {
      delete globals.Node;
      delete globals.document;
    });

    /** Focus in the field opens the bar, a click beside "Abbrechen" moves it to the root, and Tab rests on the exit element. */
    async function tabFromRoot() {
      await renderUi(<SearchBar {...props} />);
      await fireEvent(screen.getByTestId('s'), 'focus', {});
      expect(screen.queryByTestId('s.cancel')).not.toBeNull();
      await fireEvent(screen.getByTestId(ROOT), 'keyDown', keyDown('Tab'));
    }

    it('the bar closes when focus goes on from the exit element to the next control', async () => {
      await tabFromRoot();
      await fireEvent(screen.getByTestId('s.tabExit'), 'blur', { target: {}, relatedTarget: outside });
      expect(screen.queryByTestId('s.cancel')).toBeNull();
    });

    it('the bar closes when a click outside takes focus from the exit element to the page', async () => {
      await tabFromRoot();
      await fireEvent(screen.getByTestId('s.tabExit'), 'blur', { target: {}, relatedTarget: null });
      expect(screen.queryByTestId('s.cancel')).toBeNull();
    });

    it('the bar stays while the window, not the focus, goes away', async () => {
      await tabFromRoot();
      const target = {};
      globals.document = { activeElement: target };
      await fireEvent(screen.getByTestId('s.tabExit'), 'blur', { target, relatedTarget: null });
      expect(screen.queryByTestId('s.cancel')).not.toBeNull();
    });
  });

  it('a long placeholder ends in an ellipsis (DQ-038, DQ-197)', async () => {
    await open();
    const style = screen.getByTestId('s').props.style;
    expect(Object.assign({}, ...[style].flat(Infinity))).toMatchObject({ textOverflow: 'ellipsis' });
  });
});
