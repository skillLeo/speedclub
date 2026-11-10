/**
 * Space on the toggles on web. react-native-web presses on Enter for every role but on Space only for buttons, so
 * PressableScale presses a checkbox, radio or switch on Space itself (WAI-ARIA APG), once per key press.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { hydrateThemePreference } from '@/theme';
import { Checkbox } from '@/ui/Checkbox';
import { Chip } from '@/ui/Chip';
import { PressableScale } from '@/ui/PressableScale';
import { Radio } from '@/ui/Radio';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Switch } from '@/ui/Switch';

import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

type KeyInit = {
  key: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** The key went down on an element inside the control. */
  fromChild?: boolean;
  /** An earlier handler took the key already. */
  defaultPrevented?: boolean;
};

/** A keydown as react-native-web hands it over: React's synthetic event around the DOM KeyboardEvent. */
function keyDown({ key, repeat = false, altKey = false, ctrlKey = false, metaKey = false, fromChild = false, defaultPrevented = false }: KeyInit) {
  const host = {};
  return {
    key,
    nativeEvent: { key, code: key === ' ' ? 'Space' : key, repeat, altKey, ctrlKey, metaKey, shiftKey: false },
    target: fromChild ? {} : host,
    currentTarget: host,
    defaultPrevented,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
}

const SPACE = { key: ' ' };

function CheckboxHarness({ onChange }: { onChange?: (next: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      checked={checked}
      onChange={(next) => {
        onChange?.(next);
        setChecked(next);
      }}
      label="Ich bin mindestens 16 Jahre alt."
      showLabel
      testID="c"
    />
  );
}

const checkedOf = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.checked;

describe('Space on a checkbox', () => {
  it('ticks it, a second Space unticks it, and the page does not scroll', async () => {
    const onChange = jest.fn();
    await renderUi(<CheckboxHarness onChange={onChange} />);
    const first = keyDown(SPACE);
    await fireEvent(screen.getByTestId('c'), 'keyDown', first);
    expect(checkedOf('c')).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();

    await fireEvent(screen.getByTestId('c'), 'keyDown', keyDown(SPACE));
    expect(checkedOf('c')).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('a held Space changes it once, and every repeat still keeps the page from scrolling', async () => {
    const onChange = jest.fn();
    await renderUi(<CheckboxHarness onChange={onChange} />);
    await fireEvent(screen.getByTestId('c'), 'keyDown', keyDown(SPACE));
    const repeat = keyDown({ key: ' ', repeat: true });
    await fireEvent(screen.getByTestId('c'), 'keyDown', repeat);
    await fireEvent(screen.getByTestId('c'), 'keyDown', keyDown({ key: ' ', repeat: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(checkedOf('c')).toBe(true);
    expect(repeat.preventDefault).toHaveBeenCalled();
  });

  it('accepts the old "Spacebar" key value', async () => {
    await renderUi(<CheckboxHarness />);
    await fireEvent(screen.getByTestId('c'), 'keyDown', keyDown({ key: 'Spacebar' }));
    expect(checkedOf('c')).toBe(true);
  });

  it('leaves Enter and other keys to react-native-web, so nothing presses twice', async () => {
    const onChange = jest.fn();
    await renderUi(<CheckboxHarness onChange={onChange} />);
    for (const key of ['Enter', 'a', 'Tab', 'ArrowDown']) {
      const event = keyDown({ key });
      await fireEvent(screen.getByTestId('c'), 'keyDown', event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores a shortcut, a Space from a child, and a Space an earlier handler took', async () => {
    const onChange = jest.fn();
    await renderUi(<CheckboxHarness onChange={onChange} />);
    for (const init of [
      { key: ' ', ctrlKey: true },
      { key: ' ', altKey: true },
      { key: ' ', metaKey: true },
      { key: ' ', fromChild: true },
      { key: ' ', defaultPrevented: true },
    ]) {
      const event = keyDown(init);
      await fireEvent(screen.getByTestId('c'), 'keyDown', event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(checkedOf('c')).toBe(false);
  });

  it('does nothing while disabled', async () => {
    const onChange = jest.fn();
    await renderUi(<Checkbox checked={false} disabled label="AGB" onChange={onChange} testID="c" />);
    // Called directly: the test renderer drops every event on a disabled pressable before it reaches a handler.
    const event = keyDown(SPACE);
    screen.getByTestId('c').props.onKeyDown(event);
    expect(onChange).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('Space on the other toggles', () => {
  it('selects a radio', async () => {
    const onChange = jest.fn();
    await renderUi(<Radio checked={false} label="Heck" onChange={onChange} testID="r" />);
    await fireEvent(screen.getByTestId('r'), 'keyDown', keyDown(SPACE));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('flips a switch', async () => {
    const onValueChange = jest.fn();
    await renderUi(<Switch value label="Öffentlich zeigen" onValueChange={onValueChange} testID="s" />);
    const event = keyDown(SPACE);
    await fireEvent(screen.getByTestId('s'), 'keyDown', event);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(false);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('toggles a selectable chip, and leaves an action chip (role button) to react-native-web', async () => {
    const onToggle = jest.fn();
    const onAction = jest.fn();
    await renderUi(
      <>
        <Chip label="JDM" selected={false} onPress={onToggle} testID="toggle" />
        <Chip label="Filter" onPress={onAction} testID="action" />
      </>,
    );
    await fireEvent(screen.getByTestId('toggle'), 'keyDown', keyDown(SPACE));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('action').props.onKeyDown).toBeUndefined();
  });

  it('in a radiogroup: Space selects the focused segment, and an arrow key still reaches the group', async () => {
    const onChange = jest.fn();
    const drive = [
      { value: 'rwd', label: 'Heck' },
      { value: 'fwd', label: 'Front' },
      { value: 'awd', label: 'Allrad' },
    ] as const;
    // No answer yet: the first segment is the tab stop without being selected.
    await renderUi(
      <SegmentedControl options={drive} role="radiogroup" allowNone value="" onChange={onChange} label="Antrieb" testID="d" />,
    );
    await fireEvent(screen.getByTestId('d.rwd'), 'keyDown', keyDown(SPACE));
    expect(onChange).toHaveBeenCalledWith('rwd');

    // The segment does not keep the arrow from the group's roving handler in the DOM.
    const arrow = keyDown({ key: 'ArrowRight' });
    screen.getByTestId('d.rwd').props.onKeyDown(arrow);
    expect(arrow.stopPropagation).not.toHaveBeenCalled();
    expect(arrow.preventDefault).not.toHaveBeenCalled();
    onChange.mockClear();
    await fireEvent(screen.getByTestId('d'), 'keyDown', { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('fwd');
  });
});

describe('the key handler of PressableScale on web', () => {
  it('passes every key on to a caller’s own onKeyDown, Space included', async () => {
    const keys: string[] = [];
    const onPress = jest.fn();
    await renderUi(
      <PressableScale
        role="checkbox"
        aria-checked={false}
        aria-label="Merken"
        onPress={onPress}
        onKeyDown={(event) => keys.push(event.nativeEvent.key)}
        testID="p"
      />,
    );
    await fireEvent(screen.getByTestId('p'), 'keyDown', keyDown(SPACE));
    await fireEvent(screen.getByTestId('p'), 'keyDown', keyDown({ key: 'Enter' }));
    expect(keys).toEqual([' ', 'Enter']);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('adds no handler to a button or to a link with an href: react-native-web or the browser press them', async () => {
    // A link without an href does get one: react-native-web leaves its Enter to the browser, which ignores a div (see below).
    const hrefProps = { href: '/u/lukas.sc' } as object;
    await renderUi(
      <>
        <PressableScale role="button" aria-label="Speichern" onPress={jest.fn()} testID="b" />
        <PressableScale role="link" aria-label="Profil" onPress={jest.fn()} testID="l" {...hrefProps} />
      </>,
    );
    expect(screen.getByTestId('b').props.onKeyDown).toBeUndefined();
    expect(screen.getByTestId('l').props.onKeyDown).toBeUndefined();
  });
});

describe('Enter on a link (role link without href, M2.3 test round F2)', () => {
  it('presses a link-role control once per Enter; react-native-web would leave it to the browser, which never activates a div', async () => {
    const onPress = jest.fn();
    await renderUi(
      <PressableScale role="link" onPress={onPress} testID="l">
        <></>
      </PressableScale>,
    );
    const enter = keyDown({ key: 'Enter' });
    await fireEvent(screen.getByTestId('l'), 'keyDown', enter);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault).toHaveBeenCalled();
    await fireEvent(screen.getByTestId('l'), 'keyDown', keyDown({ key: 'Enter', repeat: true }));
    await fireEvent(screen.getByTestId('l'), 'keyDown', keyDown({ key: 'Enter', metaKey: true }));
    await fireEvent(screen.getByTestId('l'), 'keyDown', keyDown({ key: 'Enter', fromChild: true }));
    await fireEvent(screen.getByTestId('l'), 'keyDown', keyDown({ key: ' ' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

});
