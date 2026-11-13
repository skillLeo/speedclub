import { fireEvent, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, radius, size, space, themes, typography } from '@/theme';
import { IconButton } from '@/ui/IconButton';
import { ForcedVisualStateProvider } from '@/ui/qaVisualState';
import { Skeleton } from '@/ui/Skeleton';
import { VehicleCard, VehicleCardSkeleton } from '@/ui/VehicleCard';

import { flat, renderUi, visualOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

const base = {
  title: 'Nissan Skyline GT-R R34',
  subtitle: '2002 · 2,6 l R6 Biturbo',
  photo: { source: 'https://x/a.webp', blurhash: 'LKO2?U%2Tw=w' },
  specs: ['500 PS', '540 Nm', 'AWD'],
};

describe('VehicleCard focus ring (DQ-054)', () => {
  it('stands further off than the §5 default, because a card has no inner padding', async () => {
    await renderUi(
      <ForcedVisualStateProvider value={{ focused: true }}>
        <VehicleCard {...base} onPress={jest.fn()} testID="c" />
      </ForcedVisualStateProvider>,
    );
    expect(visualOf('c.body')).toMatchObject({ outlineOffset: space[4], outlineWidth: size.border.focusRing, outlineStyle: 'solid' });
  });
});

describe('VehicleCardSkeleton', () => {
  // The real chip: the 2 + 2 padding around the caption line, at least 24.
  it.each([
    [1, 24],
    [1.3, 24.8],
    [1.5, 28],
    [2, 36],
  ])('at font scale %s the chips are %s high, as the real ones', async (fontScale, height) => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
    await renderUi(
      <Skeleton>
        <VehicleCardSkeleton testID="s" />
      </Skeleton>,
    );
    const chip = flat(screen.getByTestId('s.chip').props.style);
    expect(chip.height).toBeCloseTo(height);
    expect(chip.height).toBeCloseTo(Math.max(size.specChip, typography.caption.lineHeight * fontScale + 2 * space[2]));
    expect(chip.width).toBeCloseTo(size.avatar.lg * fontScale);
  });
});

describe('VehicleCardSkeleton title', () => {
  // A typical title of 18 characters, measured live on DEV-01.cards.noPhoto: 332 wide at 200 % in v1 title.s (18). The 2.0
  // headline is 17, so it is about 314 wide and fits even the narrowest card. 328, 350 and 390 are the card widths at 360,
  // 390 and 430; 300 is a narrower column, where it wraps.
  it.each([
    [1, 328, 1],
    [1.5, 328, 1],
    [2, 300, 2],
    [2, 328, 1],
    [2, 350, 1],
    [2, 390, 1],
    [2, 640, 1],
  ])('at font scale %s and a card of %i it takes %i lines', async (fontScale, width, lines) => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
    await renderUi(
      <Skeleton>
        <VehicleCardSkeleton testID="s" />
      </Skeleton>,
    );
    await fireEvent(screen.getByTestId('s.text'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 60 } } });
    expect(screen.getByTestId('s.title').children).toHaveLength(lines);
  });
});

describe('VehicleCard', () => {
  it('has a 4:3 photo radius 12, headline, callout sub-line and spec chips', async () => {
    await renderUi(<VehicleCard {...base} testID="c" />);
    const photo = flat(screen.getByTestId('c.photo').props.style);
    expect(photo.aspectRatio).toBeCloseTo(4 / 3);
    expect(photo.borderRadius).toBe(radius.md);
    expect(flat(screen.getByText(base.title).props.style).fontSize).toBe(typography.headline.fontSize);
    const sub = flat(screen.getByText(base.subtitle).props.style);
    expect(sub.fontSize).toBe(typography.callout.fontSize);
    expect(sub.color).toBe(themes.carbon.color.text.secondary);
    expect(screen.getByText('540 Nm')).toBeTruthy();
  });

  it('is one link named by its visible text', async () => {
    const onPress = jest.fn();
    await renderUi(<VehicleCard {...base} onPress={onPress} testID="c" />);
    const link = screen.getByRole('link', { name: 'Nissan Skyline GT-R R34, 2002 · 2,6 l R6 Biturbo, 500 PS, 540 Nm, AWD' });
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes no control without onPress', async () => {
    await renderUi(<VehicleCard {...base} testID="c" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the Hauptfahrzeug badge 12 from the corner, neutral like every badge (ADR-431 f)', async () => {
    await renderUi(<VehicleCard {...base} isMain onPress={jest.fn()} testID="c" />);
    const badge = flat(screen.getByTestId('c.badge').props.style);
    // The badge row (Hauptfahrzeug, then Beispiel/Editorial of 09 §8.19) sits 12 from the corner.
    const row = flat(screen.getByTestId('c.badges').props.style);
    expect(row.top).toBe(space[12]);
    expect(row.left).toBe(space[12]);
    expect(badge.borderColor).toBeUndefined();
    expect(badge.borderWidth).toBeUndefined();
    expect(badge.backgroundColor).toBe(themes.carbon.color.onPhoto.chipBg);
    expect(screen.getByRole('link', { name: /^Hauptfahrzeug, Nissan/ })).toBeTruthy();
  });

  it('has no badge by default', async () => {
    await renderUi(<VehicleCard {...base} testID="c" />);
    expect(screen.queryByTestId('c.badge')).toBeNull();
  });

  it('shows the optional owner row', async () => {
    await renderUi(<VehicleCard {...base} owner={{ username: '@lukas.sc', time: 'vor 2 Std.' }} testID="c" />);
    expect(screen.getByTestId('c.owner')).toBeTruthy();
    expect(flat(screen.getByText('vor 2 Std.').props.style).color).toBe(themes.carbon.color.text.tertiary);
  });

  it('keeps the trailing control and the completeness line outside the card link', async () => {
    const onPress = jest.fn();
    const onQr = jest.fn();
    await renderUi(
      <VehicleCard
        {...base}
        onPress={onPress}
        completeness={{ label: 'Build zu 70 % vollständig', value: 0.7 }}
        trailing={<IconButton icon="qr-code" label="QR-Code" onPress={onQr} />}
        testID="c"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'QR-Code' }));
    expect(onQr).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText('Build zu 70 % vollständig')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Build zu 70 % vollständig' })).toBeTruthy();
  });
});
