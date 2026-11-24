import { act, fireEvent, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { defaultChoice, UPLOAD_MAX_REGIONS, type PlateBlurChoice } from '@/features/media/plateBlur/model';
import { PlateBlurEditor } from '@/features/media/plateBlur/PlateBlurEditor';
import { usePlateBlurReview, type PlateBlurReview } from '@/features/media/plateBlur/PlateBlurReview';
import { hydrateThemePreference } from '@/theme';
import { dismissToast } from '@/ui';
import { ToastHost } from '@/ui/ToastHost';

import { renderUi } from '../ui/helpers';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

beforeAll(hydrateThemePreference);

const PHOTO = { uri: 'file:///picked/m3.jpg', width: 4000, height: 3000 };
const ID = 'GAR-07.plateBlur';
/** A 400 × 300 stage: 1 % of the photo is 4 px across and 3 px down. */
const STAGE = { width: 400, height: 300 };

function Controlled({ onValue, initial = defaultChoice(), mode }: { onValue: jest.Mock; initial?: PlateBlurChoice; mode?: 'upload' | 'existing' }) {
  const [value, setValue] = useState<PlateBlurChoice>(initial);
  return (
    <>
      <PlateBlurEditor
        photo={PHOTO}
        value={value}
        mode={mode}
        onChange={(next) => {
          onValue(next);
          setValue(next);
        }}
        testID={ID}
      />
      <ToastHost />
    </>
  );
}

const layoutStage = async () => {
  await fireEvent(screen.getByTestId(`${ID}.stage`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...STAGE } } });
};

/** The editor reads drags from window coordinates (a turned box would rotate its own); the finger starts at 100, 100. */
const pan = async (testID: string, translationX: number, translationY: number) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(testID), [
      { translationX: 0, translationY: 0, absoluteX: 100, absoluteY: 100 },
      { translationX, translationY, absoluteX: 100 + translationX, absoluteY: 100 + translationY },
    ]);
  });
};

const lastValue = (mock: jest.Mock): PlateBlurChoice => mock.mock.calls[mock.mock.calls.length - 1]?.[0] as PlateBlurChoice;

afterEach(async () => {
  await act(async () => {
    dismissToast();
  });
});

describe('PlateBlurEditor (M5.9a)', () => {
  it('opens with the switch on and the suggested rectangle, with the hint and the note', async () => {
    await renderUi(<Controlled onValue={jest.fn()} />);
    await layoutStage();
    expect(screen.getByTestId(`${ID}.switch`)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Kennzeichen unkenntlich machen' }).props['aria-checked'] ?? true).toBeTruthy();
    const region = screen.getByTestId(`${ID}.region.0`);
    const style = Object.assign({}, ...[region.props.style].flat(3).filter(Boolean)) as { left: number; top: number; width: number; height: number };
    expect(style).toMatchObject({ left: 0.32 * 400, top: 0.7 * 300, width: 0.36 * 400 });
    expect(style.height).toBeCloseTo(0.12 * 300);
    expect(screen.getByText('Rechteck verschieben', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Später ändern geht nur mit neuem Upload.')).toBeTruthy();
  });

  it('moves the rectangle with a drag and stops it at the photo edge', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    await pan(`${ID}.region.0.pan`, 40, -60);
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.42, y: 0.5, w: 0.36, h: 0.12 });
    await pan(`${ID}.region.0.pan`, 4000, 4000);
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.64, y: 0.88, w: 0.36, h: 0.12 });
    // The on-photo hint goes once the member has moved the rectangle.
    expect(screen.queryByTestId(`${ID}.photoHint`)).toBeNull();
  });

  it('resizes from the corner handle, clamped to 2 % and the photo', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    await pan(`${ID}.region.0.handlePan`, 40, 15);
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.32, y: 0.7, w: 0.46, h: 0.17 });
    await pan(`${ID}.region.0.handlePan`, -4000, -4000);
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.32, y: 0.7, w: 0.02, h: 0.02 });
    await pan(`${ID}.region.0.handlePan`, 4000, 4000);
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.32, y: 0.7, w: 0.68, h: 0.3 });
  });

  it('adds rectangles up to 8, then the button is off', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    for (let index = 1; index < UPLOAD_MAX_REGIONS; index += 1) await fireEvent.press(screen.getByTestId(`${ID}.add`));
    expect(lastValue(onValue).regions).toHaveLength(UPLOAD_MAX_REGIONS);
    expect(screen.getByTestId(`${ID}.region.7`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}.add`)).toBeDisabled();
  });

  it('removes a rectangle with ×; the last one switches the blur off, and Rückgängig brings it back', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    await fireEvent.press(screen.getByTestId(`${ID}.add`));
    await fireEvent.press(screen.getByTestId(`${ID}.region.1.remove`));
    expect(lastValue(onValue)).toEqual(defaultChoice());
    await fireEvent.press(screen.getByTestId(`${ID}.region.0.remove`));
    expect(lastValue(onValue)).toEqual({ on: false, regions: [] });
    expect(screen.queryByTestId(`${ID}.region.0`)).toBeNull();
    expect(screen.getByTestId(`${ID}.offToast`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`${ID}.offToast.action`));
    expect(lastValue(onValue)).toEqual(defaultChoice());
  });

  it('the switch turns the blur off and on again with the same rectangles', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    await pan(`${ID}.region.0.pan`, 40, 0);
    const moved = lastValue(onValue).regions;
    await fireEvent.press(screen.getByTestId(`${ID}.switch`));
    expect(lastValue(onValue).on).toBe(false);
    expect(screen.queryByTestId(`${ID}.region.0`)).toBeNull();
    expect(screen.getByText('Das Foto wird so hochgeladen, wie es ist.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`${ID}.switch`));
    expect(lastValue(onValue)).toEqual({ on: true, regions: moved });
  });

  it('labels each rectangle with its position and offers move and size actions to screen readers', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    const move = screen.getByTestId(`${ID}.region.0.move`);
    expect(move.props['aria-label']).toBe('Rechteck 1: 32 % von links, 70 % von oben, 36 × 12 %');
    expect((move.props.accessibilityActions as { name: string }[]).map((action) => action.name)).toEqual([
      'moveLeft',
      'moveRight',
      'moveUp',
      'moveDown',
      'grow',
      'shrink',
      'turnLeft',
      'turnRight',
    ]);
    await fireEvent(move, 'accessibilityAction', { nativeEvent: { actionName: 'moveLeft' } });
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.31, y: 0.7, w: 0.36, h: 0.12 });
    await fireEvent(screen.getByTestId(`${ID}.region.0.move`), 'accessibilityAction', { nativeEvent: { actionName: 'grow' } });
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.31, y: 0.7, w: 0.38, h: 0.13 });
    await fireEvent(screen.getByTestId(`${ID}.region.0.move`), 'accessibilityAction', { nativeEvent: { actionName: 'shrink' } });
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.31, y: 0.7, w: 0.36, h: 0.12 });
  });

  it('turns the rectangle with the slider, the turn handle and the screen reader actions, within ±45°', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} />);
    await layoutStage();
    const thumb = screen.getByTestId(`${ID}.angle.thumb`);
    expect(thumb.props.role).toBe('slider');
    expect(thumb.props['aria-label']).toBe('Winkel von Rechteck 1');
    expect(thumb.props['aria-valuemin']).toBe(-45);
    expect(thumb.props['aria-valuemax']).toBe(45);
    expect(thumb.props['aria-valuetext']).toBe('gerade');

    await fireEvent(thumb, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(lastValue(onValue).regions[0]).toEqual({ x: 0.32, y: 0.7, w: 0.36, h: 0.12, angle: 1 });
    expect(screen.getByTestId(`${ID}.angle.value`, { includeHiddenElements: true })).toHaveTextContent('+1°');
    expect(screen.getByTestId(`${ID}.angle.thumb`).props['aria-valuetext']).toBe('1 Grad nach rechts gedreht');
    expect(screen.getByTestId(`${ID}.region.0.move`).props['aria-label']).toBe('Rechteck 1: 32 % von links, 70 % von oben, 36 × 12 %, 1 Grad nach rechts gedreht');

    await fireEvent(screen.getByTestId(`${ID}.region.0.move`), 'accessibilityAction', { nativeEvent: { actionName: 'turnLeft' } });
    expect(lastValue(onValue).regions[0]?.angle).toBe(-4);
    expect(screen.getByTestId(`${ID}.angle.value`, { includeHiddenElements: true })).toHaveTextContent('−4°');

    // The turn handle sits above the middle of the top edge; dragged far to the right it turns the box clockwise, up to the 45° stop.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(`${ID}.region.0.turnPan`), [
        { absoluteX: 0, absoluteY: 0 },
        { absoluteX: 1000, absoluteY: 0 },
      ]);
    });
    expect(lastValue(onValue).regions[0]?.angle).toBe(45);
    // Past the stop it stays at 45 and the box keeps its place and size.
    expect(lastValue(onValue).regions[0]).toMatchObject({ x: 0.32, y: 0.7, w: 0.36, h: 0.12 });
    const region = screen.getByTestId(`${ID}.region.0`);
    const style = Object.assign({}, ...[region.props.style].flat(3).filter(Boolean)) as { transform?: { rotate: string }[] };
    expect(style.transform).toEqual([{ rotate: '45deg' }]);
  });

  it('GAR-08 mode has no switch and keeps an empty list without switching anything off', async () => {
    const onValue = jest.fn();
    await renderUi(<Controlled onValue={onValue} mode="existing" />);
    await layoutStage();
    expect(screen.queryByTestId(`${ID}.switch`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`${ID}.region.0.remove`));
    expect(lastValue(onValue).regions).toEqual([]);
    expect(screen.queryByTestId(`${ID}.offToast`)).toBeNull();
    expect(screen.getByText('Das Verpixeln ersetzt das Foto. Zum Ändern lädst du das Foto neu hoch.')).toBeTruthy();
  });
});

describe('usePlateBlurReview (M5.9a)', () => {
  const held: { review: PlateBlurReview | null } = { review: null };
  function Host() {
    const review = usePlateBlurReview('GAR-07');
    useEffect(() => {
      held.review = review;
    });
    return <>{review.element}</>;
  }
  const photos = [PHOTO, { uri: 'file:///picked/heck.jpg', width: 3000, height: 4000 }, { uri: 'file:///picked/felge.jpg', width: 3000, height: 3000 }];

  it('pages through one editor per photo and resolves every photo with its choice', async () => {
    await renderUi(<Host />);
    let result: unknown = undefined;
    await act(async () => {
      void held.review?.review(photos).then((value) => {
        result = value;
      });
    });
    expect(screen.getByText('Foto 1 von 3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`${ID}.switch`));
    await fireEvent.press(screen.getByTestId(`${ID}.next`));
    expect(screen.getByText('Foto 2 von 3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`${ID}.next`));
    expect(screen.getByText('Foto 3 von 3')).toBeTruthy();
    expect(screen.getByText('3 Fotos hochladen')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId(`${ID}.confirm`));
    });
    expect(result).toEqual([
      { ...photos[0], plateBlur: { on: false, regions: defaultChoice().regions } },
      { ...photos[1], plateBlur: defaultChoice() },
      { ...photos[2], plateBlur: defaultChoice() },
    ]);
  });

  it('never blocks: "Alle … jetzt hochladen" goes on from the first page with the defaults', async () => {
    await renderUi(<Host />);
    let result: unknown = undefined;
    await act(async () => {
      void held.review?.review(photos).then((value) => {
        result = value;
      });
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId(`${ID}.confirmAll`));
    });
    expect(result).toEqual(photos.map((photo) => ({ ...photo, plateBlur: defaultChoice() })));
  });

  it('"Für alle übernehmen" copies the shown choice to every photo', async () => {
    await renderUi(<Host />);
    let result: unknown = undefined;
    await act(async () => {
      void held.review?.review(photos).then((value) => {
        result = value;
      });
    });
    await fireEvent.press(screen.getByTestId(`${ID}.add`));
    await fireEvent.press(screen.getByTestId(`${ID}.applyAll`));
    await act(async () => {
      await fireEvent.press(screen.getByTestId(`${ID}.confirmAll`));
    });
    const choices = (result as { plateBlur: PlateBlurChoice }[]).map((entry) => entry.plateBlur.regions.length);
    expect(choices).toEqual([2, 2, 2]);
  });

  it('closing asks first, and "Nicht hochladen" resolves with nothing', async () => {
    await renderUi(<Host />);
    let result: unknown = undefined;
    await act(async () => {
      void held.review?.review([PHOTO]).then((value) => {
        result = value;
      });
    });
    expect(screen.queryByTestId(`${ID}.pager`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`${ID}.sheet.scrim`));
    expect(screen.getByText('Foto nicht hochladen?')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId(`${ID}.discard.confirm`));
    });
    expect(result).toBeNull();
  });
});
