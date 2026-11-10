// DQ-151: the browser centres an autofocused field, which at 200 % opened AUTH-05 in the middle of its first sentence.
import { screen } from '@testing-library/react-native';
import { createRef, forwardRef, useImperativeHandle, type ComponentRef } from 'react';
import { View, type TextInput, type ViewProps } from 'react-native';

import { CodeInput } from '@/features/auth/components/CodeInput';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const mockFocus = jest.fn();
const mockScrollIntoView = jest.fn();

/** The DOM field: the test renderer's own input has no `scrollIntoView`, and a shared mock for `focus`. */
const FakeInput = forwardRef<object, ViewProps>(function FakeInput(props, ref) {
  useImperativeHandle(ref, () => ({ focus: mockFocus, scrollIntoView: mockScrollIntoView }), []);
  return <View {...props} />;
});

beforeAll(() => {
  const reactNative = jest.requireActual<{ TextInput: unknown }>('react-native');
  jest.spyOn(reactNative, 'TextInput', 'get').mockReturnValue(FakeInput);
});
beforeAll(hydrateThemePreference);
beforeEach(() => jest.clearAllMocks());

describe('CodeInput on web', () => {
  it('takes focus without the browser scroll, then scrolls only as far as it needs', async () => {
    await renderUi(<CodeInput value="" onChange={jest.fn()} label="Code" autoFocus testID="code" />);
    expect(screen.getByTestId('code').props.autoFocus).toBeUndefined();
    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(mockFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(mockScrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(mockFocus.mock.invocationCallOrder[0]).toBeLessThan(mockScrollIntoView.mock.invocationCallOrder[0] ?? 0);
  });

  it('without autoFocus it stays out of the way', async () => {
    await renderUi(<CodeInput value="" onChange={jest.fn()} label="Code" testID="code" />);
    expect(mockFocus).not.toHaveBeenCalled();
    expect(mockScrollIntoView).not.toHaveBeenCalled();
  });

  it('still hands the field to the form, which focuses it on an error', async () => {
    const ref = createRef<ComponentRef<typeof TextInput>>();
    await renderUi(<CodeInput ref={ref} value="" onChange={jest.fn()} label="Code" testID="code" />);
    expect((ref.current as unknown as { focus: unknown }).focus).toBe(mockFocus);
  });
});
