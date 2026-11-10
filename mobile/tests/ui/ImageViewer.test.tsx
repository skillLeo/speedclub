import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { hydrateThemePreference } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { ImageViewer } from '@/ui/ImageViewer';
import {
  VIEWER_MAX_SCALE,
  clampPan,
  clampScale,
  fittedSize,
  nextPage,
  panLimit,
  shouldDismiss,
  zoomAround,
} from '@/ui/imageViewerMath';

import { renderUi } from './helpers';

jest.mock('expo-haptics', () => ({}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeAll(hydrateThemePreference);

const images = Array.from({ length: 12 }, (_, i) => ({ uri: `https://example.test/${i}.jpg` }));

describe('viewer maths', () => {
  it('zooms between 1 and 4', () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(9)).toBe(VIEWER_MAX_SCALE);
    expect(VIEWER_MAX_SCALE).toBe(4);
  });

  it('dismisses past 120 or at velocity 800, in both directions', () => {
    expect(shouldDismiss(120, 0)).toBe(false);
    expect(shouldDismiss(121, 0)).toBe(true);
    expect(shouldDismiss(-121, 0)).toBe(true);
    expect(shouldDismiss(10, 800)).toBe(false);
    expect(shouldDismiss(10, 801)).toBe(true);
    expect(shouldDismiss(10, -801)).toBe(true);
  });

  it('fits a photo inside the stage', () => {
    expect(fittedSize(400, 800, 4 / 3)).toEqual({ width: 400, height: 300 });
    expect(fittedSize(800, 400, 4 / 3).height).toBe(400);
    expect(fittedSize(400, 800, 0)).toEqual({ width: 400, height: 800 });
  });

  it('keeps a zoomed photo on the stage', () => {
    expect(panLimit(400, 400, 1)).toBe(0);
    expect(panLimit(400, 400, 2)).toBe(200);
    expect(panLimit(300, 800, 2)).toBe(0);
    expect(clampPan(500, 200)).toBe(200);
    expect(clampPan(-500, 200)).toBe(-200);
  });

  it('zooms around the focal point', () => {
    // The point 100 right of the centre stays there at 2×.
    expect(zoomAround(100, 0, 1, 2)).toBe(-100);
    expect(zoomAround(0, 0, 1, 2)).toBe(0);
  });

  it('pages on distance or a flick, and stops at the ends', () => {
    expect(nextPage(3, 12, -250, 0, 400)).toBe(4);
    expect(nextPage(3, 12, 250, 0, 400)).toBe(2);
    expect(nextPage(3, 12, -100, 0, 400)).toBe(3);
    expect(nextPage(3, 12, -100, -900, 400)).toBe(4);
    expect(nextPage(11, 12, -300, 0, 400)).toBe(11);
    expect(nextPage(0, 12, 300, 0, 400)).toBe(0);
  });
});

describe('ImageViewer', () => {
  it('renders nothing while closed', async () => {
    await renderUi(<ImageViewer visible={false} images={images} onClose={jest.fn()} testID="v" />);
    expect(screen.queryByTestId('v')).toBeNull();
  });

  it('renders nothing without photos', async () => {
    await renderUi(<ImageViewer visible images={[]} onClose={jest.fn()} testID="v" />);
    expect(screen.queryByTestId('v')).toBeNull();
  });

  it('puts the actions for the photo on screen at the end of the top bar, and none without them', async () => {
    const actions = jest.fn((index: number) => <IconButton icon="flag" label={`Foto ${index + 1} melden`} variant="onPhoto" testID="v.report" />);
    await renderUi(<ImageViewer visible images={images} initialIndex={2} onClose={jest.fn()} actions={actions} testID="v" />);
    expect(screen.getByTestId('v.report')).toBeTruthy();
    expect(actions).toHaveBeenLastCalledWith(2);
  });

  it('is a modal dialog with the counter "3/12"', async () => {
    await renderUi(<ImageViewer visible images={images} initialIndex={2} onClose={jest.fn()} testID="v" />);
    const root = screen.getByTestId('v');
    expect(root.props.role).toBe('dialog');
    expect(root.props['aria-modal']).toBe(true);
    expect(root.props['aria-label']).toBe('Bildansicht');
    const counter = screen.getByTestId('v.counter');
    expect(counter).toHaveTextContent('3/12');
    expect(counter.props.role).toBe('slider');
    expect(counter.props.accessibilityRole).toBeUndefined();
    expect(counter.props['aria-label']).toBe('Bildansicht');
    expect(counter.props['aria-valuemin']).toBe(1);
    expect(counter.props['aria-valuemax']).toBe(12);
    expect(counter.props['aria-valuenow']).toBe(3);
    expect(counter.props['aria-valuetext']).toBe('Foto 3 von 12');
  });

  it('does not close again during the exit animation', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      function Host() {
        const [visible, setVisible] = useState(true);
        return (
          <ImageViewer
            visible={visible}
            images={images}
            onClose={() => {
              onClose();
              setVisible(false);
            }}
            testID="v"
          />
        );
      }
      await renderUi(<Host />);
      await fireEvent.press(screen.getByTestId('v.close'));
      await act(async () => screen.getByTestId('v').props.onAccessibilityEscape());
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes from the close button', async () => {
    const onClose = jest.fn();
    await renderUi(<ImageViewer visible images={images} onClose={onClose} testID="v" />);
    await fireEvent.press(screen.getByTestId('v.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('steps through the photos by accessibility action, within bounds', async () => {
    const onIndexChange = jest.fn();
    await renderUi(<ImageViewer visible images={images} initialIndex={0} onIndexChange={onIndexChange} onClose={jest.fn()} testID="v" />);
    const step = (actionName: string) =>
      act(async () => {
        screen.getByTestId('v.counter').props.onAccessibilityAction({ nativeEvent: { actionName } });
      });
    await step('decrement');
    expect(onIndexChange).not.toHaveBeenCalled();
    await step('increment');
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByTestId('v.counter')).toHaveTextContent('2/12');
  });

  it('clamps a wrong initial index', async () => {
    await renderUi(<ImageViewer visible images={images} initialIndex={40} onClose={jest.fn()} testID="v" />);
    expect(screen.getByTestId('v.counter')).toHaveTextContent('12/12');
  });
});

describe('ImageViewer gestures', () => {
  const counter = () => screen.getByTestId('v.counter').props['aria-valuenow'];
  const pan = async (events: { translationX?: number; translationY?: number; velocityX?: number; velocityY?: number }) => {
    await act(async () => {
      // One event: the helper repeats it for begin, activate and end. A gesture activates with the distance already
      // moved, which decides between paging and dismissing.
      fireGestureHandler(getByGestureTestId('v.pan'), [{ translationX: 0, translationY: 0, velocityX: 0, velocityY: 0, ...events }]);
    });
  };

  it('a sideways swipe moves to the next photo', async () => {
    const onIndexChange = jest.fn();
    await renderUi(<ImageViewer visible images={images} initialIndex={2} onClose={jest.fn()} onIndexChange={onIndexChange} testID="v" />);
    await pan({ translationX: -300, velocityX: -900 });
    expect(onIndexChange).toHaveBeenCalledWith(3);
    expect(counter()).toBe(4);
  });

  it('a swipe past the last photo stays there', async () => {
    const onIndexChange = jest.fn();
    await renderUi(<ImageViewer visible images={images} initialIndex={11} onClose={jest.fn()} onIndexChange={onIndexChange} testID="v" />);
    await pan({ translationX: -300, velocityX: -900 });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(counter()).toBe(12);
  });

  it('a drag down past the threshold closes, a short one does not', async () => {
    const onClose = jest.fn();
    await renderUi(<ImageViewer visible images={images} onClose={onClose} testID="v" />);
    await pan({ translationY: 100 });
    expect(onClose).not.toHaveBeenCalled();
    await pan({ translationY: 121 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a flick down closes from a short drag', async () => {
    const onClose = jest.fn();
    await renderUi(<ImageViewer visible images={images} onClose={onClose} testID="v" />);
    await pan({ translationY: 20, velocityY: 900 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
