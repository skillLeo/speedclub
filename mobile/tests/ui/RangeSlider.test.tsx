import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import i18n from '@/i18n';
import { hydrateThemePreference, size } from '@/theme';
import { RangeSlider } from '@/ui/RangeSlider';
import {
  bubbleOffsets,
  clampHigh,
  clampLow,
  offsetToValue,
  snapValue,
  valueToOffset,
} from '@/ui/rangeSliderMath';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

const base = { min: 50, max: 1500, step: 10, lowLabel: 'Mindestleistung', highLabel: 'Höchstleistung' };

describe('rangeSliderMath', () => {
  it('snaps to the step from min, inside the range', () => {
    expect(snapValue(504, 50, 1500, 10)).toBe(500);
    expect(snapValue(506, 50, 1500, 10)).toBe(510);
    expect(snapValue(-10, 50, 1500, 10)).toBe(50);
    expect(snapValue(9999, 50, 1500, 10)).toBe(1500);
    expect(snapValue(0.3, 0, 1, 0.1)).toBe(0.3);
  });

  it('thumbs cannot cross', () => {
    expect(clampLow(800, 500, 50, 1500, 10)).toBe(490);
    expect(clampHigh(100, 500, 50, 1500, 10)).toBe(510);
  });

  it('converts between value and offset', () => {
    expect(valueToOffset(775, 290, 50, 1500)).toBeCloseTo(145);
    expect(offsetToValue(145, 290, 50, 1500)).toBeCloseTo(775);
    expect(offsetToValue(10, 0, 50, 1500)).toBe(50);
    expect(valueToOffset(50, 290, 50, 50)).toBe(0);
  });

  it('keeps bubbles apart and inside', () => {
    expect(bubbleOffsets(100, 200, 40, 40, 320, 4)).toEqual({ low: 80, high: 180 });
    const close = bubbleOffsets(150, 160, 40, 40, 320, 4);
    expect(close.low + 40 + 4).toBeLessThanOrEqual(close.high);
    const edge = bubbleOffsets(310, 318, 40, 40, 320, 4);
    expect(edge.high + 40).toBeLessThanOrEqual(320);
    const start = bubbleOffsets(2, 6, 40, 40, 320, 4);
    expect(start.low).toBe(0);
    expect(start.high).toBeGreaterThanOrEqual(44);
  });
});

describe('RangeSlider', () => {
  it('has two sliders with the aria values and the thumb size', async () => {
    await renderUi(<RangeSlider {...base} value={[300, 800]} onChange={jest.fn()} testID="r" />);
    const low = screen.getByRole('slider', { name: 'Mindestleistung' });
    expect(low.props['aria-valuemin']).toBe(50);
    expect(low.props['aria-valuemax']).toBe(1500);
    expect(low.props['aria-valuenow']).toBe(300);
    expect(flat(low.props.style).width).toBe(size.slider.thumb);
    expect(screen.getByRole('slider', { name: 'Höchstleistung' }).props['aria-valuenow']).toBe(800);
  });

  it('shows formatted values in the bubbles', async () => {
    await renderUi(<RangeSlider {...base} value={[300, 1200]} onChange={jest.fn()} testID="r" />);
    expect(screen.getByTestId('r.lowValue')).toHaveTextContent('300');
    expect(screen.getByTestId('r.highValue')).toHaveTextContent('1.200');
  });

  it.each([
    ['ArrowRight', [310, 800]],
    ['ArrowLeft', [290, 800]],
    ['PageUp', [400, 800]],
    ['PageDown', [200, 800]],
    ['Home', [50, 800]],
    ['End', [790, 800]],
  ] as const)('key %s moves the low thumb', async (key, expected) => {
    const onChange = jest.fn();
    const onChangeEnd = jest.fn();
    await renderUi(
      <RangeSlider {...base} value={[300, 800]} onChange={onChange} onChangeEnd={onChangeEnd} testID="r" />,
    );
    const preventDefault = jest.fn();
    await fireEvent(screen.getByTestId('r.low'), 'keyDown', { key, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(onChangeEnd).toHaveBeenCalledWith(expected);
  });

  it('the high thumb moves up with the keyboard and stops at the max', async () => {
    const onChange = jest.fn();
    await renderUi(<RangeSlider {...base} value={[300, 1500]} onChange={onChange} testID="r" />);
    await fireEvent(screen.getByTestId('r.high'), 'keyDown', { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('r.high'), 'keyDown', { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith([300, 1490]);
  });

  it('native screen readers can adjust it', async () => {
    const onChange = jest.fn();
    await renderUi(<RangeSlider {...base} value={[300, 800]} onChange={onChange} testID="r" />);
    await fireEvent(screen.getByTestId('r.low'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onChange).toHaveBeenCalledWith([310, 800]);
  });

  it('disabled ignores keys and reports aria-disabled', async () => {
    const onChange = jest.fn();
    await renderUi(<RangeSlider {...base} value={[300, 800]} disabled onChange={onChange} testID="r" />);
    const low = screen.getByTestId('r.low');
    expect(low.props['aria-disabled']).toBe(true);
    expect(low.props.tabIndex).toBe(-1);
    await fireEvent(low, 'keyDown', { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the numeric inputs on blur, snapped and clamped', async () => {
    const onChange = jest.fn();
    await renderUi(
      <RangeSlider
        {...base}
        value={[300, 800]}
        onChange={onChange}
        inputs={{ lowLabel: 'Von', highLabel: 'Bis', suffix: 'PS' }}
        testID="r"
      />,
    );
    const low = screen.getByTestId('r.lowInput');
    expect(low.props.value).toBe('300');
    await fireEvent.changeText(low, '504');
    await fireEvent(low, 'blur');
    expect(onChange).toHaveBeenLastCalledWith([500, 800]);
    const high = screen.getByTestId('r.highInput');
    await fireEvent.changeText(high, '100');
    await fireEvent(high, 'blur');
    expect(onChange).toHaveBeenLastCalledWith([300, 310]);
  });

  it('ignores an input that is not a number', async () => {
    const onChange = jest.fn();
    await renderUi(
      <RangeSlider {...base} value={[300, 800]} onChange={onChange} inputs={{ lowLabel: 'Von', highLabel: 'Bis' }} testID="r" />,
    );
    const low = screen.getByTestId('r.lowInput');
    await fireEvent.changeText(low, 'abc');
    await fireEvent(low, 'blur');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('r.lowInput').props.value).toBe('300');
  });
});

describe('RangeSlider drags', () => {
  const translateOf = (testID: string) => {
    const transform = flat(screen.getByTestId(testID).props.style).transform as unknown as { translateX: number }[];
    return transform[0]?.translateX;
  };
  /** Thumb 28: 318 of travel over 145 steps of 10. */
  const layoutRail = async () => {
    await fireEvent(screen.getByTestId('r.rail'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 318, height: 28 } } });
  };
  const drag = async (testID: string, translationX: number) => {
    await act(async () => {
      fireGestureHandler(getByGestureTestId(testID), [{ translationX: 0 }, { translationX }]);
    });
  };

  function Controlled({ onChange, onChangeEnd }: { onChange?: jest.Mock; onChangeEnd?: jest.Mock }) {
    const [value, setValue] = useState<[number, number]>([500, 800]);
    return (
      <RangeSlider
        {...base}
        value={value}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
        onChangeEnd={onChangeEnd}
        testID="r"
      />
    );
  }

  it('a parent that follows gets every step and one end', async () => {
    const onChange = jest.fn();
    const onChangeEnd = jest.fn();
    await renderUi(<Controlled onChange={onChange} onChangeEnd={onChangeEnd} />);
    await layoutRail();
    await drag('r.low.pan', 58);
    expect(onChange).toHaveBeenCalled();
    expect(onChangeEnd).toHaveBeenCalledTimes(1);
    const end = onChangeEnd.mock.calls[0]?.[0] as [number, number];
    expect(end[0]).toBeGreaterThan(500);
    expect(end[1]).toBe(800);
  });

  it('a thumb dragged past the other one stops short of it', async () => {
    const onChangeEnd = jest.fn();
    await renderUi(<Controlled onChangeEnd={onChangeEnd} />);
    await layoutRail();
    await drag('r.low.pan', 300);
    const end = onChangeEnd.mock.calls[0]?.[0] as [number, number];
    expect(end).toEqual([790, 800]);
  });

  it('a parent that refuses gets the thumb back at its own value', async () => {
    const onChange = jest.fn();
    await renderUi(<RangeSlider {...base} value={[500, 800]} onChange={onChange} testID="r" />);
    await layoutRail();
    const before = translateOf('r.low');
    await drag('r.low.pan', 58);
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByTestId('r.low').props['aria-valuenow']).toBe(500);
    expect(translateOf('r.low')).toBeCloseTo(before ?? 0);
  });
});

describe('RangeSlider number inputs', () => {
  afterEach(() => i18n.changeLanguage('de'));

  it.each([
    ['de', '1.200', 1200],
    ['en', '1,200', 1200],
    ['en', '1200', 1200],
  ])('in %s, "%s" commits %i', async (language, typed, value) => {
    await i18n.changeLanguage(language);
    const onChange = jest.fn();
    await renderUi(
      <RangeSlider {...base} value={[500, 1400]} onChange={onChange} inputs={{ lowLabel: 'Von', highLabel: 'Bis' }} testID="r" />,
    );
    const input = screen.getByTestId('r.highInput');
    await fireEvent.changeText(input, typed);
    await fireEvent(input, 'blur');
    expect(onChange).toHaveBeenCalledWith([500, value]);
  });

  it('ignores what is no number', async () => {
    const onChange = jest.fn();
    await renderUi(
      <RangeSlider {...base} value={[500, 1400]} onChange={onChange} inputs={{ lowLabel: 'Von', highLabel: 'Bis' }} testID="r" />,
    );
    const input = screen.getByTestId('r.highInput');
    await fireEvent.changeText(input, 'viel');
    await fireEvent(input, 'blur');
    expect(onChange).not.toHaveBeenCalled();
  });
});
