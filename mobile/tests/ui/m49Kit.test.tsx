/** M4.9: CarouselSnap reports the centred card (GAR-01 page pills and the focused car's action row). */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';

import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { Text } from '@/ui';
import { setReducedMotionPreview } from '@/ui/motion';
import { CarouselSnap, QrReveal } from '@/ui/motion/kit';
import { carouselIndex, carouselProgress } from '@/ui/motion/math';

import { renderUi } from './helpers';

beforeAll(hydrateThemePreference);
afterEach(async () => {
  await act(async () => setReducedMotionPreview(null));
});

describe('carousel index maths', () => {
  it('rounds the offset to the nearest card and keeps it inside the list', () => {
    expect(carouselIndex(0, 252, 3)).toBe(0);
    expect(carouselIndex(125, 252, 3)).toBe(0);
    expect(carouselIndex(127, 252, 3)).toBe(1);
    expect(carouselIndex(504, 252, 3)).toBe(2);
    // Overscroll on either side (iOS bounce) stays on the first or last card.
    expect(carouselIndex(-80, 252, 3)).toBe(0);
    expect(carouselIndex(900, 252, 3)).toBe(2);
  });

  it('answers 0 while unmeasured or empty', () => {
    expect(carouselIndex(300, 0, 3)).toBe(0);
    expect(carouselIndex(300, 252, 0)).toBe(0);
    expect(carouselProgress(300, 0)).toBe(0);
  });

  it('gives the progress as a fraction of an interval', () => {
    expect(carouselProgress(378, 252)).toBeCloseTo(1.5);
  });
});

const CARS = [
  { key: 'e46', title: 'BMW M3 E46' },
  { key: 'gr', title: 'Toyota GR Yaris' },
  { key: 'r34', title: 'Nissan Skyline GT-R R34' },
];

function carousel(onIndexChange: (index: number) => void, progress = makeMutable(0)) {
  return (
    <GestureHandlerRootView>
      <ThemeProvider>
        <CarouselSnap
          items={CARS}
          keyOf={(car) => car.key}
          labelOf={(car) => car.title}
          renderItem={(car) => <Text>{car.title}</Text>}
          itemWidth={240}
          gap={12}
          progress={progress}
          onIndexChange={onIndexChange}
          testID="t.c"
        />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const scrollTo = async (x: number) => {
  await fireEvent.scroll(screen.getByTestId('t.c.scroll'), { nativeEvent: { contentOffset: { x, y: 0 } } });
};

describe.each([false, true])('CarouselSnap focus (reduced motion %s)', (reduced) => {
  it('tells the caller once per new centred card and writes the progress', async () => {
    await act(async () => setReducedMotionPreview(reduced));
    const onIndexChange = jest.fn();
    const progress = makeMutable(0);
    await renderUi(carousel(onIndexChange, progress));
    expect(screen.getByTestId('t.c.card.e46')).toBeTruthy();

    await scrollTo(260);
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(progress.get()).toBeCloseTo(260 / 252);
    await scrollTo(270);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    await scrollTo(504);
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    await scrollTo(0);
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    expect(onIndexChange).toHaveBeenCalledTimes(3);
  });
});

describe('QrReveal placeholder (M4.9)', () => {
  it('shows the placeholder until the card is revealed, then only the card', async () => {
    const stage = (revealed: boolean) => (
      <ThemeProvider>
        <QrReveal revealed={revealed} placeholder={<Text>Lädt</Text>} testID="q">
          <Text>Karte</Text>
        </QrReveal>
      </ThemeProvider>
    );
    const view = await renderUi(stage(false));
    expect(screen.getByTestId('q.placeholder')).toBeTruthy();
    await view.rerender(stage(true));
    expect(screen.queryByTestId('q.placeholder')).toBeNull();
    expect(screen.getByText('Karte')).toBeTruthy();
  });
});
